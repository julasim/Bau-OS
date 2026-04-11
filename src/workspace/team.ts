import fs from "fs";
import path from "path";
import { atomicWriteSync } from "./helpers.js";

const teamFilePath = path.join(process.cwd(), "data", "team.json");

function loadTeam(): string[] {
  if (!fs.existsSync(teamFilePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(teamFilePath, "utf-8"));
  } catch {
    return [];
  }
}

function saveTeamFile(members: string[]): void {
  const dir = path.dirname(teamFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  atomicWriteSync(teamFilePath, JSON.stringify(members, null, 2));
}

export function listTeam(): string[] {
  return loadTeam();
}

export function addTeamMember(name: string): boolean {
  const team = loadTeam();
  if (team.includes(name)) return false;
  team.push(name);
  saveTeamFile(team);
  return true;
}

export function removeTeamMember(name: string): boolean {
  const team = loadTeam();
  const filtered = team.filter((m) => m !== name);
  if (filtered.length === team.length) return false;
  saveTeamFile(filtered);
  return true;
}
