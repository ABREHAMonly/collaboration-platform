// src/services/aiService.ts - Fixed for Apollo Server 4
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { db } from '../database/client.js';
import { logger } from './logger.js';
import { TaskService } from './taskService.js';
import { ProjectService } from './projectService.js';
import { PubSub } from 'graphql-subscriptions';

// Custom error classes for services
class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

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
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
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

      await logger.info('AI_TASKS_GENERATED', 
        { projectId, prompt, tasksGenerated: createdTasks.length }, 
        userId, 
        ipAddress
      );

      return createdTasks;

    } catch (error) {
      console.error('AIService - generateTasksFromPrompt error:', error);
      
      await logger.error('AI_TASKS_GENERATION_FAILED', 
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
}

// Initialize AI service on import
AIService.initialize();