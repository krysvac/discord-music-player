import {DefaultProgressBarOptions, DMPError, DMPErrors, ProgressBarOptions, Queue, Utils} from "..";

class ProgressBar {
  private queue: Queue;
  private options: ProgressBarOptions = DefaultProgressBarOptions;
  private bar!: string;
  private times!: string;

  /**
   * ProgressBar constructor
   * @param {Queue} queue
   * @param {ProgressBarOptions} [options=DefaultProgressBarOptions]
   */
  constructor(queue: Queue, options: ProgressBarOptions = DefaultProgressBarOptions) {

    /**
     * Guild instance
     * @name ProgressBar#guild
     * @type {Guild}
     * @private
     */

    /**
     * ProgressBar options
     * @name ProgressBar#options
     * @type {PlayerOptions}
     */

    /**
     * Progress Bar without timecodes
     * @name ProgressBar#bar
     * @type {string}
     */

    /**
     * Progress Bar timecodes
     * @name ProgressBar#times
     * @type {string}
     */

    if (queue.destroyed)
      throw new DMPError(DMPErrors.QUEUE_DESTROYED);
    if (!queue.connection)
      throw new DMPError(DMPErrors.NO_VOICE_CONNECTION);
    if (!queue.isPlaying)
      throw new DMPError(DMPErrors.NOTHING_PLAYING);

    this.queue = queue;

    this.options = Object.assign(
      {} as ProgressBarOptions,
      this.options,
      options
    )

    this.create();
  }

  /**
   * Progress Bar in a prettier representation
   * @type {string}
   */
  public get prettier(): string {
    return `[${this.bar}][${this.times}]`;
  }

  /**
   * Progress Bar in string representation
   * @returns {string}
   */
  public toString(): string {
    return this.options.time ? this.prettier : `[${this.bar}]`;
  }

  /**
   * Creates the Progress Bar
   * @private
   */
  private create() {
    const {size, arrow, block} = this.options;
    const currentTime = this.queue.nowPlaying!.seekTime + this.queue.connection!.time;
    const progress = Math.round((size! * currentTime / this.queue.nowPlaying!.milliseconds));
    const emptyProgress = size! - progress;

    this.bar = block!.repeat(progress) + arrow! + ' '.repeat(emptyProgress);
    this.times = `${Utils.msToTime(currentTime)}/${this.queue.nowPlaying!.duration}`;
  }
}

export {ProgressBar};
