// Barrel re-export for all vault modules
export { saveNote, listNotes, readNote, updateNote, appendToNote, deleteNote } from "./notes.js";
export { saveTask, listTasks, completeTask } from "./tasks.js";
export { saveTermin, listTermine, deleteTermin } from "./termine.js";
export { listProjects, getProjectInfo, listProjectNotes, readProjectNote } from "./projects.js";
export type { ProjectInfo } from "./projects.js";
export { readFile, createFile, listFolder } from "./files.js";
export { searchVault } from "./search.js";
export type { SearchResult } from "./search.js";
export {
  PROTECTED_AGENTS,
  estimateTokens,
  getAgentPath, isProtectedAgent, listAgents,
  vaultExists, getVaultPath,
  isMainWorkspaceConfigured, finalizeMainWorkspace,
  loadAgentWorkspace, createAgentWorkspace, inspectAgentWorkspace,
  appendAgentConversation, loadAgentHistory, clearAgentToday,
  appendAgentMemory,
  readAgentFile, writeAgentFile,
  shouldCompact, getLogForCompaction, writeCompactedLog,
} from "./agents.js";
export type { ConversationEntry, SetupAnswers, WorkspaceFileInfo } from "./agents.js";
