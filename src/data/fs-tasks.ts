// Filesystem-Implementation: wrapped bestehende vault/tasks.ts
import * as vault from "../workspace/tasks.js";
import type { Task, TaskRepository } from "./types.js";

export const fsTasks: TaskRepository = {
  async save(text, project) {
    return vault.saveTask(text, project) as Task;
  },
  async list(project) {
    return vault.listTasks(project);
  },
  async listOpen(project) {
    return vault.listOpenTasks(project);
  },
  async get(id, project) {
    return vault.getTask(id, project);
  },
  async update(id, updates, project) {
    return vault.updateTask(id, updates, project);
  },
  async complete(textOrId, project) {
    return vault.completeTask(textOrId, project);
  },
  async delete(id, project) {
    return vault.deleteTask(id, project);
  },
};
