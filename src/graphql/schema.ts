// src/graphql/schema.ts
import { gql } from 'apollo-server-express';

// Base types following your TypeScript patterns
export const typeDefs = gql`
  scalar DateTime

  type User {
    id: ID!
    email: String!
    globalStatus: GlobalStatus!
    createdAt: DateTime!
    updatedAt: DateTime!
    lastLogin: DateTime
  }

  type UserDevice {
    id: ID!
    ipAddress: String
    userAgent: String
    deviceInfo: JSON
    loginTime: DateTime!
    isRevoked: Boolean!
    lastActive: DateTime!
  }

  type Workspace {
    id: ID!
    name: String!
    description: String
    createdAt: DateTime!
    updatedAt: DateTime!
    createdBy: User!
    members: [WorkspaceMember!]!
  }

  type WorkspaceMember {
    id: ID!
    user: User!
    role: WorkspaceRole!
    joinedAt: DateTime!
  }

  type Project {
    id: ID!
    name: String!
    description: String
    workspace: Workspace!
    createdAt: DateTime!
    updatedAt: DateTime!
    createdBy: User!
    members: [ProjectMember!]!
    tasks: [Task!]!
  }

  type ProjectMember {
    id: ID!
    user: User!
    role: ProjectRole!
    joinedAt: DateTime!
  }

  type Task {
    id: ID!
    title: String!
    description: String
    status: TaskStatus!
    project: Project!
    createdBy: User!
    assignedTo: [User!]!
    dueDate: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Notification {
    id: ID!
    title: String!
    body: String
    status: NotificationStatus!
    relatedEntityId: ID
    entityType: String
    createdAt: DateTime!
    readAt: DateTime
  }

  type AuthPayload {
    accessToken: String!
    refreshToken: String!
    user: User!
  }

  type AuditLog {
    id: ID!
    timestamp: DateTime!
    level: LogLevel!
    userId: ID
    ipAddress: String
    action: String!
    details: JSON!
    message: String
  }

  # Enums following your TypeScript enum patterns
  enum GlobalStatus {
    ACTIVE
    BANNED
    ADMIN
  }

  enum WorkspaceRole {
    OWNER
    MEMBER
    VIEWER
  }

  enum ProjectRole {
    PROJECT_LEAD
    CONTRIBUTOR
    VIEWER
  }

  enum TaskStatus {
    TODO
    IN_PROGRESS
    DONE
  }

  enum NotificationStatus {
    DELIVERED
    SEEN
  }

  enum LogLevel {
    info
    warn
    error
    security
  }

  # Input types
  input RegisterInput {
    email: String!
    password: String!
  }

  input CreateWorkspaceInput {
    name: String!
    description: String
  }

  input AddWorkspaceMemberInput {
    workspaceId: ID!
    userId: ID!
    role: WorkspaceRole = MEMBER
  }

  input UpdateWorkspaceMemberRoleInput {
    workspaceId: ID!
    userId: ID!
    role: WorkspaceRole!
  }

  input CreateProjectInput {
    name: String!
    description: String
    workspaceId: ID!
  }

  input UpdateProjectMemberRoleInput {
    projectId: ID!
    userId: ID!
    role: ProjectRole!
  }

  input CreateTaskInput {
    title: String!
    description: String
    projectId: ID!
    assignedToIds: [ID!]
    dueDate: DateTime
  }

  input UpdateTaskInput {
    taskId: ID!
    title: String
    description: String
    status: TaskStatus
    assignedToIds: [ID!]
    dueDate: DateTime
  }

  input ForgotPasswordInput {
    email: String!
  }

  input ResetPasswordInput {
    token: String!
    newPassword: String!
  }

  input UpdatePasswordInput {
    currentPassword: String!
    newPassword: String!
  }

  input AdminResetPasswordInput {
    userId: ID!
    newPassword: String!
  }

  input AISummarizeInput {
    taskDescription: String!
  }

  input AIGenerateTasksInput {
    prompt: String!
    projectId: ID!
  }

  # Queries
  type Query {
    # Auth
    me: User

    # Workspaces
    workspace(id: ID!): Workspace
    myWorkspaces: [Workspace!]!
    
    # Admin only
    getAllWorkspaces: [Workspace!]!
    getAuditLogs(
      level: LogLevel
      userId: ID
      startDate: DateTime
      endDate: DateTime
      limit: Int = 50
    ): [AuditLog!]!

    # Projects
    project(id: ID!): Project
    workspaceProjects(workspaceId: ID!): [Project!]!

    # Tasks
    task(id: ID!): Task
    projectTasks(projectId: ID!): [Task!]!

    # Notifications
    myNotifications(status: NotificationStatus): [Notification!]!

    # AI Features
    summarizeTask(input: AISummarizeInput!): String!
  }

  # Mutations
  type Mutation {
    # Authentication (GraphQL)
    register(input: RegisterInput!): AuthPayload!
    forgotPassword(input: ForgotPasswordInput!): Boolean!
    updatePassword(input: UpdatePasswordInput!): Boolean!

    # Admin mutations
    userBan(userId: ID!): User!
    userUnban(userId: ID!): User!
    adminResetPassword(input: AdminResetPasswordInput!): Boolean!

    # Workspace mutations
    createWorkspace(input: CreateWorkspaceInput!): Workspace!
    addWorkspaceMember(input: AddWorkspaceMemberInput!): WorkspaceMember!
    removeWorkspaceMember(workspaceId: ID!, userId: ID!): Boolean!
    updateWorkspaceMemberRole(input: UpdateWorkspaceMemberRoleInput!): WorkspaceMember!

    # Project mutations
    createProject(input: CreateProjectInput!): Project!
    updateProjectMemberRole(input: UpdateProjectMemberRoleInput!): ProjectMember!
    deleteProject(projectId: ID!): Boolean!

    # Task mutations
    createTask(input: CreateTaskInput!): Task!
    updateTask(input: UpdateTaskInput!): Task!
    deleteTask(taskId: ID!): Boolean!

    # Notification mutations
    markNotificationAsRead(notificationId: ID!): Notification!
    markAllNotificationsAsRead: Boolean!

    # AI mutations
    generateTasksFromPrompt(input: AIGenerateTasksInput!): [Task!]!
  }

  # Subscriptions
  type Subscription {
    taskStatusUpdated(workspaceId: ID!): Task!
  }

  # Scalars
  scalar JSON
`;