export interface RuntimeWorkerActivity {
  runOnce: () => Promise<boolean>
}

export interface RuntimeSweepActivity {
  sweep: () => Promise<unknown>
}

export interface RuntimeBackgroundLoopOptions {
  workerPollMs: number
  workerBatchSize: number
  sweepIntervalMs: number
  onError?: (activity: 'worker' | 'sweeper', error: unknown) => void
}

export class RuntimeBackgroundLoop {
  #started = false
  #stopped = false
  #workerTimer: ReturnType<typeof setTimeout> | undefined
  #sweeperTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly worker: RuntimeWorkerActivity,
    private readonly sweeper: RuntimeSweepActivity,
    private readonly options: RuntimeBackgroundLoopOptions,
  ) {
    if (!Number.isSafeInteger(options.workerPollMs) || options.workerPollMs < 1)
      throw new TypeError('workerPollMs must be a positive safe integer')
    if (!Number.isSafeInteger(options.workerBatchSize) || options.workerBatchSize < 1)
      throw new TypeError('workerBatchSize must be a positive safe integer')
    if (!Number.isSafeInteger(options.sweepIntervalMs) || options.sweepIntervalMs < 1)
      throw new TypeError('sweepIntervalMs must be a positive safe integer')
  }

  start(): void {
    if (this.#started)
      return
    this.#started = true
    this.#stopped = false
    void this.#runWorkerCycle()
    void this.#runSweepCycle()
  }

  stop(): void {
    this.#stopped = true
    if (this.#workerTimer)
      clearTimeout(this.#workerTimer)
    if (this.#sweeperTimer)
      clearTimeout(this.#sweeperTimer)
    this.#workerTimer = undefined
    this.#sweeperTimer = undefined
  }

  async #runWorkerCycle(): Promise<void> {
    try {
      for (let index = 0; index < this.options.workerBatchSize && !this.#stopped; index += 1) {
        if (!await this.worker.runOnce())
          break
      }
    }
    catch (error) {
      this.options.onError?.('worker', error)
    }
    if (!this.#stopped) {
      this.#workerTimer = setTimeout(() => void this.#runWorkerCycle(), this.options.workerPollMs)
      this.#workerTimer.unref?.()
    }
  }

  async #runSweepCycle(): Promise<void> {
    try {
      await this.sweeper.sweep()
    }
    catch (error) {
      this.options.onError?.('sweeper', error)
    }
    if (!this.#stopped) {
      this.#sweeperTimer = setTimeout(() => void this.#runSweepCycle(), this.options.sweepIntervalMs)
      this.#sweeperTimer.unref?.()
    }
  }
}
