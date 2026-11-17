/**
 * TodoWriteTool — Server-side todo_write tool implementation.
 * Ported from Chaterm's src/main/agent/core/task/todo-tools/todo_write_tool.ts
 *
 * Validates todos, applies focus chain logic, generates formatted output.
 */

import { v4 as uuidv4 } from 'uuid';
import { getActiveLocale, tr } from '@/core/i18n';

export interface TodoInput {
  id?: string;
  content: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
}

export interface TodoItem {
  id: string;
  content: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
  createdAt: Date;
  updatedAt: Date;
  isFocused?: boolean;
  focusedAt?: Date;
  completedAt?: Date;
}

export class TodoWriteTool {
  /**
   * Execute todo_write — validate, apply focus chain logic, persist via provided callback.
   */
  execute(
    params: { todos: TodoInput[] },
    taskId: string
  ): string {
    const now = new Date();

    // Preprocess: ensure each todo has id and timestamps
    const processed = params.todos.map((t): TodoItem => ({
      id: t.id || uuidv4(),
      content: t.content,
      description: t.description,
      status: t.status,
      priority: t.priority,
      createdAt: now,
      updatedAt: now,
      ...(t.status === 'in_progress' ? { isFocused: true, focusedAt: now } : {}),
      ...(t.status === 'completed' ? { completedAt: now } : {}),
    }));

    // Basic validation
    if (processed.length === 0) {
      return tr(
        getActiveLocale(),
        '待办列表为空，没有需要管理的任务。',
        'Todo list is empty. No tasks to manage.',
        'Danh sách công việc trống. Không có công việc nào để quản lý.',
      );
    }

    // Validate statuses
    const inProgressCount = processed.filter((t) => t.status === 'in_progress').length;
    if (inProgressCount > 1) {
      // Fix: only keep the first as in_progress, reset others to pending
      let found = false;
      for (const t of processed) {
        if (t.status === 'in_progress') {
          if (found) {
            t.status = 'pending';
            t.isFocused = false;
            t.focusedAt = undefined;
          } else {
            found = true;
          }
        }
      }
    }

    // Auto-focus logic: if no in_progress but has pending, set first pending to in_progress
    if (inProgressCount === 0) {
      const firstPending = processed.find((t) => t.status === 'pending');
      if (firstPending) {
        firstPending.status = 'in_progress';
        firstPending.isFocused = true;
        firstPending.focusedAt = now;
      }
    }

    // Clear focus from completed items
    for (const t of processed) {
      if (t.status === 'completed') {
        t.isFocused = false;
        t.focusedAt = undefined;
        if (!t.completedAt) t.completedAt = now;
      }
    }

    // Generate output
    return this.generateOutput(processed);
  }

  /**
   * Generate formatted markdown output grouped by status.
   */
  generateOutput(todos: TodoItem[]): string {
    const inProgress = todos.filter((t) => t.status === 'in_progress');
    const pending = todos.filter((t) => t.status === 'pending');
    const completed = todos.filter((t) => t.status === 'completed');

    const total = todos.length;
    const done = completed.length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    const locale = getActiveLocale();

    let output = `## ${tr(locale, '任务清单', 'Todo List', 'Danh sách công việc')} (${done}/${total} ${tr(locale, '完成', 'completed', 'hoàn thành')} — ${progress}%)\n\n`;

    if (inProgress.length > 0) {
      output += `**🔄 ${tr(locale, '进行中', 'In Progress', 'Đang thực hiện')}**\n`;
      for (const t of inProgress) {
        output += `- [${t.id}] ${this.priorityIcon(t.priority)} **${t.content}**`;
        if (t.description) output += ` — ${t.description}`;
        output += '\n';
      }
      output += '\n';
    }

    if (pending.length > 0) {
      output += `**📋 ${tr(locale, '待处理', 'Pending', 'Đang chờ')}**\n`;
      for (const t of pending) {
        output += `- [${t.id}] ${this.priorityIcon(t.priority)} ${t.content}\n`;
      }
      output += '\n';
    }

    if (completed.length > 0) {
      output += `**✅ ${tr(locale, '已完成', 'Completed', 'Đã hoàn thành')}**\n`;
      for (const t of completed) {
        output += `- ~~${t.content}~~\n`;
      }
      output += '\n';
    }

    // Reminder: if all are pending and >1, remind to focus
    if (pending.length > 1 && inProgress.length === 0) {
      output += `⚠️ ${tr(
        locale,
        '所有任务都处于待处理状态。请立即将首个任务设为 in_progress 并开始执行。',
        'All tasks are pending. Please set the first task to in_progress and start executing immediately.',
        'Tất cả công việc đều đang ở trạng thái chờ. Vui lòng chuyển công việc đầu tiên sang in_progress và bắt đầu thực hiện ngay.',
      )}\n`;
    }

    // Focus chain suggestion
    if (completed.length > 0 && pending.length > 0) {
      const next = pending[0];
      output += `\n💡 ${tr(
        locale,
        `下一个任务是: **${next!.content}**。请使用 focus_task(${next!.id}) 聚焦并开始执行。`,
        `Next task: **${next!.content}**. Use focus_task(${next!.id}) to focus and start executing.`,
        `Công việc tiếp theo: **${next!.content}**. Hãy dùng focus_task(${next!.id}) để tập trung và bắt đầu thực hiện.`,
      )}\n`;
    }

    return output.trim();
  }

  private priorityIcon(priority: string): string {
    switch (priority) {
      case 'high': return '🔴';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  }
}
