/**
 * TodoReminderService — Detects todo list changes and generates
 * human-readable notifications.
 * Ported from Chaterm's src/main/agent/services/todo_reminder_service.ts
 */

import { getActiveLocale, tr } from '@/core/i18n';
import type { TodoItem } from './todo-write-tool';

export interface TodoChange {
  type: 'added' | 'removed' | 'status_changed' | 'priority_changed' | 'list_created' | 'list_cleared';
  todoId: string;
  todoContent?: string;
  oldStatus?: string;
  newStatus?: string;
}

export class TodoReminderService {
  private previousTodos: TodoItem[] = [];
  private previousMap = new Map<string, TodoItem>();

  /**
   * Detect changes between the new todo list and the previous snapshot.
   */
  detectChanges(newTodos: TodoItem[]): TodoChange[] {
    const changes: TodoChange[] = [];

    if (this.previousTodos.length === 0 && newTodos.length > 0) {
      changes.push({
        type: 'list_created',
        todoId: 'all',
        todoContent: tr(
          getActiveLocale(),
          `创建了包含 ${newTodos.length} 个任务的任务清单`,
          `Created a todo list with ${newTodos.length} task(s)`,
          `Đã tạo danh sách gồm ${newTodos.length} công việc`,
        ),
      });
      this.updateSnapshot(newTodos);
      return changes;
    }

    if (this.previousTodos.length > 0 && newTodos.length === 0) {
      changes.push({
        type: 'list_cleared',
        todoId: 'all',
        todoContent: tr(
          getActiveLocale(),
          '任务清单已清空',
          'Todo list cleared',
          'Đã xóa sạch danh sách công việc',
        ),
      });
      this.updateSnapshot(newTodos);
      return changes;
    }

    const newMap = new Map<string, TodoItem>();
    for (const t of newTodos) newMap.set(t.id, t);

    // Detect added items
    for (const [id, item] of newMap) {
      if (!this.previousMap.has(id)) {
        changes.push({
          type: 'added',
          todoId: id,
          todoContent: item.content,
        });
      }
    }

    // Detect removed items
    for (const [id, item] of this.previousMap) {
      if (!newMap.has(id)) {
        changes.push({
          type: 'removed',
          todoId: id,
          todoContent: item.content,
        });
      }
    }

    // Detect status changes
    for (const [id, newItem] of newMap) {
      const oldItem = this.previousMap.get(id);
      if (oldItem && oldItem.status !== newItem.status) {
        changes.push({
          type: 'status_changed',
          todoId: id,
          todoContent: newItem.content,
          oldStatus: oldItem.status,
          newStatus: newItem.status,
        });
      }
    }

    this.updateSnapshot(newTodos);
    return changes;
  }

  /**
   * Generate a human-readable summary of changes.
   */
  summarizeChanges(changes: TodoChange[]): string | null {
    if (changes.length === 0) return null;

    const completedItems = changes.filter((c) => c.type === 'status_changed' && c.newStatus === 'completed');
    const newItems = changes.filter((c) => c.type === 'added' || c.type === 'list_created');

    const parts: string[] = [];
    const locale = getActiveLocale();

    if (completedItems.length > 0) {
      const names = completedItems.map((c) => c.todoContent).join(', ');
      parts.push(`✅ ${tr(locale, '已完成', 'Completed', 'Đã hoàn thành')}: ${names}`);
    }

    if (newItems.length > 0) {
      const names = newItems.map((c) => c.todoContent).join(', ');
      parts.push(`📋 ${tr(locale, '新增任务', 'Added', 'Công việc mới')}: ${names}`);
    }

    return parts.join('\n');
  }

  /**
   * Update the previous snapshot for next comparison.
   */
  private updateSnapshot(todos: TodoItem[]): void {
    this.previousTodos = [...todos];
    this.previousMap.clear();
    for (const t of todos) {
      this.previousMap.set(t.id, { ...t });
    }
  }

  /**
   * Reset the service state.
   */
  reset(): void {
    this.previousTodos = [];
    this.previousMap.clear();
  }
}
