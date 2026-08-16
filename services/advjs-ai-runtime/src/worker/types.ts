export interface TaskWorker {
  runOnce: () => Promise<boolean>
}
