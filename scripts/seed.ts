-- scripts/seed.ts
import { db } from '../src/database/client.js';
import { hashPassword } from '../src/utils/authUtils.js';

async function seedDatabase() {
  try {
    console.log('🌱 Seeding database with sample data...');

    // Create admin user
    const adminPasswordHash = await hashPassword('admin123');
    const adminResult = await db.query(
      `INSERT INTO users (email, password_hash, global_status) 
       VALUES ($1, $2, 'ADMIN') 
       ON CONFLICT (email) DO UPDATE SET global_status = 'ADMIN'
       RETURNING id`,
      ['admin@example.com', adminPasswordHash]
    );

    const adminId = adminResult.rows[0].id;
    console.log('✅ Admin user created/updated');

    // Create regular user
    const userPasswordHash = await hashPassword('user123');
    const userResult = await db.query(
      `INSERT INTO users (email, password_hash, global_status) 
       VALUES ($1, $2, 'ACTIVE') 
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      ['user@example.com', userPasswordHash]
    );

    const userId = userResult.rows[0]?.id;
    if (userId) {
      console.log('✅ Regular user created');
    }

    // Create sample workspace
    const workspaceResult = await db.query(
      `INSERT INTO workspaces (name, description, created_by) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (name) DO UPDATE SET description = $2
       RETURNING id`,
      ['Development Team', 'Sample workspace for development collaboration', adminId]
    );

    const workspaceId = workspaceResult.rows[0].id;
    console.log('✅ Sample workspace created/updated');

    // Add user to workspace if created
    if (userId) {
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) 
         VALUES ($1, $2, 'MEMBER') 
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [workspaceId, userId]
      );
      console.log('✅ User added to workspace');
    }

    // Create sample project
    const projectResult = await db.query(
      `INSERT INTO projects (name, description, workspace_id, created_by) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (name, workspace_id) DO UPDATE SET description = $2
       RETURNING id`,
      ['Website Redesign', 'Redesign company website with modern UI/UX', workspaceId, adminId]
    );

    const projectId = projectResult.rows[0].id;
    console.log('✅ Sample project created/updated');

    // Add project members
    if (userId) {
      await db.query(
        `INSERT INTO project_members (project_id, user_id, role) 
         VALUES ($1, $2, 'CONTRIBUTOR') 
         ON CONFLICT (project_id, user_id) DO NOTHING`,
        [projectId, userId]
      );
      console.log('✅ User added to project');
    }

    // Create sample tasks
    const sampleTasks = [
      {
        title: 'Design Homepage Layout',
        description: 'Create wireframes and mockups for the new homepage design',
        status: 'IN_PROGRESS'
      },
      {
        title: 'Implement Responsive Navigation',
        description: 'Build mobile-friendly navigation menu with dropdown support',
        status: 'TODO'
      },
      {
        title: 'Optimize Page Load Performance',
        description: 'Reduce page load times by optimizing images and code',
        status: 'TODO'
      },
      {
        title: 'Add Contact Form Validation',
        description: 'Implement client-side and server-side validation for contact forms',
        status: 'DONE'
      }
    ];

    for (const task of sampleTasks) {
      await db.query(
        `INSERT INTO tasks (title, description, status, project_id, created_by) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (title, project_id) DO NOTHING`,
        [task.title, task.description, task.status, projectId, adminId]
      );
    }
    console.log('✅ Sample tasks created');

    console.log('🎉 Database seeding completed successfully!');
    console.log('');
    console.log('📋 Sample Data Created:');
    console.log('   👨‍💼 Admin: admin@example.com / admin123');
    if (userId) {
      console.log('   👤 User: user@example.com / user123');
    }
    console.log('   🏢 Workspace: Development Team');
    console.log('   📁 Project: Website Redesign');
    console.log('   ✅ Tasks: 4 sample tasks with different statuses');

    process.exit(0);

  } catch (error) {
    console.error('❌ Database seeding failed:', error);
    process.exit(1);
  }
}

seedDatabase();