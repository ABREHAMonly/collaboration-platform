// src/services/aiService.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { db } from '../database/client.js';
import { logSystem, logActivity } from '../services/logger.js';
import { TaskService } from './taskService.js';
import { ProjectService } from './projectService.js';
import { ForbiddenError } from 'apollo-server-express';
import { PubSub } from 'graphql-subscriptions';

export class AIService {
  private static genAI: GoogleGenerativeAI | null = null;
  private static model: any = null;

  static initialize() {
    if (!env.geminiApiKey) {
      console.warn('⚠️ Gemini API key not configured - AI features disabled');
      return;
    }

    try {
      this.genAI = new GoogleGenerativeAI(env.geminiApiKey);
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
      console.log('✅ Gemini AI service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Gemini AI:', error);
    }
  }

  static async summarizeTask(taskDescription: string): Promise<string> {
    if (!this.model) {
      throw new Error('AI service not available');
    }

    try {
      const prompt = `
        Please provide a concise 1-2 sentence summary of the following task description.
        Focus on the key objectives and deliverables.
        
        Task Description: "${taskDescription}"
        
        Summary:
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();

    } catch (error) {
      console.error('AIService - summarizeTask error:', error);
      throw new Error('Failed to generate task summary');
    }
  }

  static async generateTasksFromPrompt(
    input: any, 
    userId: string, 
    ipAddress?: string, 
    pubsub?: PubSub
  ): Promise<any[]> {
    const { prompt, projectId } = input;

    if (!this.model) {
      throw new Error('AI service not available');
    }

    // Verify user has CONTRIBUTOR access to project
    const hasAccess = await ProjectService.hasProjectAccess(projectId, userId, 'CONTRIBUTOR');
    if (!hasAccess) {
      throw new ForbiddenError('Insufficient permissions to create tasks in this project');
    }

    try {
      const aiPrompt = `
        Based on the following project prompt, generate a structured list of specific, actionable tasks.
        Return the tasks as a JSON array of objects with "title" and "description" fields.
        Each task should be clear, measurable, and achievable.
        
        Project Prompt: "${prompt}"
        
        Return ONLY valid JSON in this exact format:
        [
          {
            "title": "Task title here",
            "description": "Task description here"
          }
        ]
        
        Generate 3-8 tasks depending on the complexity of the prompt.
      `;

      const result = await this.model.generateContent(aiPrompt);
      const response = await result.response;
      const text = response.text().trim();

      // Clean the response - remove markdown code blocks if present
      const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();

      let tasksData;
      try {
        tasksData = JSON.parse(cleanText);
      } catch (parseError) {
        console.error('Failed to parse AI response:', cleanText);
        throw new Error('AI response format error - failed to parse tasks');
      }

      if (!Array.isArray(tasksData)) {
        throw new Error('AI response format error - expected array of tasks');
      }

      // Create tasks in database
      const createdTasks = [];
      for (const taskData of tasksData.slice(0, 8)) { // Limit to 8 tasks max
        if (taskData.title && taskData.description) {
          try {
            const task = await TaskService.createTask(
              {
                title: taskData.title,
                description: taskData.description,
                projectId,
                assignedToIds: [] // Unassigned by default
              },
              userId,
              ipAddress,
              pubsub
            );
            createdTasks.push(task);
          } catch (taskError) {
            console.error('Failed to create AI-generated task:', taskError);
            // Continue with other tasks
          }
        }
      }

      await logSystem('info', 'AI_TASKS_GENERATED', 
        { projectId, prompt, tasksGenerated: createdTasks.length }, 
        userId, 
        ipAddress
      );

      await logActivity('AI_TASKS_GENERATED', 
        { projectId, prompt, tasksGenerated: createdTasks.length }, 
        userId, 
        ipAddress
      );

      return createdTasks;

    } catch (error) {
      console.error('AIService - generateTasksFromPrompt error:', error);
      
      await logSystem('error', 'AI_TASKS_GENERATION_FAILED', 
        { projectId, prompt, error: error instanceof Error ? error.message : 'Unknown error' }, 
        userId, 
        ipAddress
      );

      throw new Error('Failed to generate tasks from prompt');
    }
  }

  static async estimateTaskComplexity(taskDescription: string): Promise<string> {
    if (!this.model) {
      throw new Error('AI service not available');
    }

    try {
      const prompt = `
        Analyze the following task and estimate its complexity level.
        Return ONLY one of these three options: LOW, MEDIUM, or HIGH.
        
        Task: "${taskDescription}"
        
        Complexity:
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const complexity = response.text().trim().toUpperCase();

      if (['LOW', 'MEDIUM', 'HIGH'].includes(complexity)) {
        return complexity;
      } else {
        return 'MEDIUM'; // Default fallback
      }

    } catch (error) {
      console.error('AIService - estimateTaskComplexity error:', error);
      return 'MEDIUM'; // Default fallback on error
    }
  }

  static async suggestTaskAssignments(
    taskDescription: string, 
    projectId: string
  ): Promise<string[]> {
    if (!this.model) {
      throw new Error('AI service not available');
    }

    try {
      // Get project members for context
      const projectMembers = await db.query(`
        SELECT u.id, u.email, pm.role 
        FROM project_members pm 
        JOIN users u ON pm.user_id = u.id 
        WHERE pm.project_id = $1
      `, [projectId]);

      const membersContext = projectMembers.rows.map(member => 
        `${member.email} (${member.role})`
      ).join(', ');

      const prompt = `
        Based on the task description and available team members, suggest which team members would be best suited for this task.
        Consider their roles and the task requirements.
        
        Task: "${taskDescription}"
        
        Available Team Members: ${membersContext}
        
        Return ONLY a JSON array of user IDs that would be good candidates for this task.
        Format: ["user_id_1", "user_id_2"]
        
        Suggested Assignments:
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();

      const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
      
      try {
        const suggestedIds = JSON.parse(cleanText);
        if (Array.isArray(suggestedIds)) {
          // Validate that suggested IDs are actual project members
          const validMemberIds = projectMembers.rows.map(member => member.id);
          return suggestedIds.filter((id: string) => validMemberIds.includes(id));
        }
      } catch (parseError) {
        console.error('Failed to parse AI assignment suggestions:', cleanText);
      }

      return [];

    } catch (error) {
      console.error('AIService - suggestTaskAssignments error:', error);
      return [];
    }
  }
}

// Initialize AI service on import
AIService.initialize();