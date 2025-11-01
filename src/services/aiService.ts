// src/services/aiService.ts - UPDATED with correct Gemini 2.5 models
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { db } from '../database/client.js';
import { logger } from './logger.js';
import { TaskService } from './taskService.js';
import { ProjectService } from './projectService.js';
import { PubSub } from 'graphql-subscriptions';

interface AIGenerateTasksInput {
  prompt: string;
  projectId: string;
}

interface AITaskData {
  title: string;
  description: string;
}

export class AIService {
  private static genAI: GoogleGenerativeAI | null = null;
  private static model: any = null;
  private static isAvailable = false;
  private static currentModel: string | null = null;

  static async initialize() {
    if (!env.geminiApiKey) {
      console.warn('⚠️ Gemini API key not configured - AI features disabled');
      return;
    }

    try {
      console.log('🔧 Initializing Gemini AI service...');
      this.genAI = new GoogleGenerativeAI(env.geminiApiKey);
      
      // Try the LATEST model names from Google AI Studio
      const modelsToTry = [
        'gemini-2.5-flash',           // Primary - latest flash model
        'gemini-2.5-pro',             // Primary - latest pro model  
        'gemini-flash-latest',        // Latest flash
        'gemini-2.5-flash-lite',      // Lite version
        'gemini-1.5-flash',           // Fallback to 1.5
        'gemini-1.5-pro',             // Fallback to 1.5 pro
        'gemini-pro'                  // Legacy fallback
      ];

      let foundWorkingModel = false;

      for (const modelName of modelsToTry) {
        try {
          console.log(`🔄 Trying model: ${modelName}`);
          this.model = this.genAI.getGenerativeModel({ model: modelName });
          
          // Simple test to see if model works
          const testResult = await this.model.generateContent('Say "Hello" in one word');
          await testResult.response;
          
          console.log(`✅ Successfully initialized with model: ${modelName}`);
          this.isAvailable = true;
          foundWorkingModel = true;
          this.currentModel = modelName;
          break;
        } catch (modelError: any) {
          console.log(`❌ Model ${modelName} failed:`, modelError.message?.substring(0, 100));
          continue;
        }
      }

      if (!foundWorkingModel) {
        console.error('❌ No working Gemini model found. AI features disabled.');
        this.model = null;
        this.isAvailable = false;
        this.currentModel = null;
      }

    } catch (error: any) {
      console.error('❌ Failed to initialize Gemini AI:', error.message);
      this.model = null;
      this.isAvailable = false;
      this.currentModel = null;
    }
  }

  static async summarizeTask(taskDescription: string): Promise<string> {
    if (!this.isAvailable || !this.model) {
      return `Summary: ${taskDescription.substring(0, 150)}${taskDescription.length > 150 ? '...' : ''} [AI unavailable]`;
    }

    try {
      const prompt = `Please provide a concise 1-2 sentence summary of: "${taskDescription}"`;
      console.log(`🤖 Using ${this.currentModel} for summarization`);
      
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    } catch (error: any) {
      console.error('AIService - summarizeTask error:', error.message);
      return `Summary: ${taskDescription.substring(0, 150)}${taskDescription.length > 150 ? '...' : ''} [AI temporarily unavailable]`;
    }
  }

  static async generateTasksFromPrompt(
    input: AIGenerateTasksInput,
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

    // If AI service is not available, return mock tasks immediately
    if (!this.isAvailable || !this.model) {
      console.log('🤖 AI service not available, using mock tasks');
      return await this.createMockTasks(prompt, projectId, userId, ipAddress, pubsub);
    }

    try {
      console.log(`🤖 Using ${this.currentModel} for task generation`);
      
      const aiPrompt = `
        Based on this project goal: "${prompt}"
        
        Please generate 3-5 specific, actionable tasks as a JSON array.
        Each task should have a clear title and description.
        
        Return ONLY valid JSON in this exact format:
        [
          {
            "title": "Specific task title",
            "description": "Clear description of what needs to be done"
          }
        ]
        
        Make the tasks practical and achievable.
      `;

      const result = await this.model.generateContent(aiPrompt);
      const response = await result.response;
      const text = response.text().trim();

      // Clean the response - remove markdown code blocks if present
      const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
      console.log(`🤖 AI raw response: ${cleanText.substring(0, 200)}...`);

      let tasksData: AITaskData[];
      try {
        tasksData = JSON.parse(cleanText);
        console.log(`✅ AI generated ${tasksData.length} tasks`);
      } catch (parseError) {
        console.error('Failed to parse AI response, using mock tasks');
        return await this.createMockTasks(prompt, projectId, userId, ipAddress, pubsub);
      }

      if (!Array.isArray(tasksData)) {
        throw new Error('AI response format error - expected array of tasks');
      }

      // Create tasks in database
      const createdTasks = [];
      for (const taskData of tasksData.slice(0, 5)) {
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
            
            createdTasks.push({
              id: task.id,
              title: task.title,
              description: task.description,
              status: task.status
            });
          } catch (taskError) {
            console.error('Failed to create AI-generated task:', taskError);
          }
        }
      }

      await logger.info('AI_TASKS_GENERATED', 
        { projectId, prompt, tasksGenerated: createdTasks.length, model: this.currentModel }, 
        userId, 
        ipAddress
      );

      return createdTasks;

    } catch (error: any) {
      console.error('AIService - generateTasksFromPrompt error:', error.message);
      console.log('🤖 AI service failed, falling back to mock tasks');
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
          
          createdTasks.push({
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status
          });
        } catch (taskError) {
          console.error('Failed to create mock task:', taskError);
        }
      }

      await logger.info('MOCK_TASKS_GENERATED', 
        { projectId, prompt, tasksGenerated: createdTasks.length }, 
        userId, 
        ipAddress
      );

      console.log(`🤖 Created ${createdTasks.length} mock tasks for project ${projectId}`);
      return createdTasks;

    } catch (error) {
      console.error('AIService - createMockTasks error:', error);
      return [];
    }
  }

  // Get AI service status
  static getStatus(): { isAvailable: boolean; model: string | null } {
    return {
      isAvailable: this.isAvailable,
      model: this.currentModel
    };
  }
}

// Initialize AI service
AIService.initialize().catch(console.error);