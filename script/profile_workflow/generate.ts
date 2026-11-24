// Retired: profile research is performed by Codex and submitted as review rows.
// Keep the old entry point inert so existing commands cannot call Gemini or edit sheets.
console.error(
  "Geminiによるプロフィール生成は廃止されました。Codexに調査を依頼し、IMDB_PROFILE_WORKFLOWへreviewで登録してください。",
);
process.exitCode = 1;
