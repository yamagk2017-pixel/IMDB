import "./env.js";
import { WorkflowSheet } from "./sheets.js";

WorkflowSheet.fromEnvironment()
  .then(() => console.log("ワークフローシートを初期化しました"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
