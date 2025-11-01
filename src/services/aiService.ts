// src/services/aiService.ts - Fixed for Apollo Server 4
// src/services/aiService.ts - FIXED for free tier Gemini
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { db } from '../database/client.js';
import { logger } from './logger.js';
import { TaskService } from './taskService.js';
import { ProjectService } from './projectService.js';
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
      // Use the correct FREE tier model name
      this.model = this.genAI.getGenerativeModel({ model: "gemini-pro" });
      console.log('✅ Gemini AI service initialized with gemini-pro (free tier)');
    } catch (error) {
      console.error('❌ Failed to initialize Gemini AI:', error);
    }
  }

  static async summarizeTask(taskDescription: string): Promise<string> {
    if (!this.model) {
      // Return a simple fallback summary if AI is not available
      return `Summary: ${taskDescription.substring(0, 150)}${taskDescription.length > 150 ? '...' : ''}`;
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

    } catch (error: any) {
      console.error('AIService - summarizeTask error:', error);
      // Return a simple fallback instead of throwing
      return `Summary: ${taskDescription.substring(0, 150)}${taskDescription.length > 150 ? '...' : ''} [AI temporarily unavailable]`;
    }
  }

  static async generateTasksFromPrompt(
    input: any, 
    userId: string, 
    ipAddress?: string, 
    pubsub?: PubSub
  ): Promise<any[]> {
    const { prompt, projectId } = input;

    // Verify user has CONTRIBUTOR access to project
    const hasAccess = await ProjectService.hasProjectAccess(projectId, userId, 'CONTRIBUTOR');
    if (!hasAccess) {
      throw new Error('Insufficient permissions to create tasks in this project');
    }

    // If AI service is not available, return mock tasks
    if (!this.model) {
      console.log('AI service not available, returning mock tasks');
      return await this.createMockTasks(prompt, projectId, userId, ipAddress, pubsub);
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
        
        Generate 3-5 tasks depending on the complexity of the prompt.
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
        // Fallback to mock tasks if parsing fails
        return await this.createMockTasks(prompt, projectId, userId, ipAddress, pubsub);
      }

      if (!Array.isArray(tasksData)) {
        throw new Error('AI response format error - expected array of tasks');
      }

      // Create tasks in database
      const createdTasks = [];
      for (const taskData of tasksData.slice(0, 5)) { // Limit to 5 tasks max
        if (taskData.title && taskData.description) {
          try {
            const task = await TaskService.createTask(
              {
                title: taskData.title,
                description: taskData.description,
                projectId,
                assignedToIds: []
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

      await logger.info('AI_TASKS_GENERATED', 
        { projectId, prompt, tasksGenerated: createdTasks.length }, 
        userId, 
        ipAddress
      );

      return createdTasks;

    } catch (error) {
      console.error('AIService - generateTasksFromPrompt error:', error);
      
      // Fallback to mock tasks on AI service failure
      console.log('AI service failed, falling back to mock tasks');
      return await this.createMockTasks(prompt, projectId, userId, ipAddress, pubsub);
    }
  }

  // Create mock tasks when AI service is unavailable
  private static async createMockTasks(
    prompt: string, 
    projectId: string, 
    userId: string, 
    ipAddress?: string, 
    pubsub?: PubSub
  ): Promise<any[]> {
    try {
      const mockTasks = [
        {
          title: "Define project requirements and scope",
          description: "Document all requirements and define the project scope clearly."
        },
        {
          title: "Create project timeline and milestones",
          description: "Develop a detailed timeline with key milestones and deadlines."
        },
        {
          title: "Set up development environment",
          description: "Prepare all necessary tools and environments for development."
        },
        {
          title: "Design user interface and experience",
          description: "Create wireframes and design mockups for the user interface."
        },
        {
          title: "Develop core functionality",
          description: "Implement the main features and core functionality of the project."
        }
      ];

      const createdTasks = [];
      for (const taskData of mockTasks) {
        try {
          const task = await TaskService.createTask(
            {
              title: `${taskData.title} - ${prompt.substring(0, 30)}...`,
              description: taskData.description,
              projectId,
              assignedToIds: []
            },
            userId,
            ipAddress,
            pubsub
          );
          createdTasks.push(task);
        } catch (taskError) {
          console.error('Failed to create mock task:', taskError);
        }
      }

      await logger.info('MOCK_TASKS_GENERATED', 
        { projectId, prompt, tasksGenerated: createdTasks.length }, 
        userId, 
        ipAddress
      );

      return createdTasks;

    } catch (error) {
      console.error('AIService - createMockTasks error:', error);
      return [];
    }
  }

  static async estimateTaskComplexity(taskDescription: string): Promise<string> {
    if (!this.model) {
      return 'MEDIUM'; // Default fallback
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
}

// Initialize AI service on import
AIService.initialize();