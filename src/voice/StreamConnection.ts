/**
 * Main of the code comes from the @discordjs/voice repo:
 * @link https://github.com/discordjs/voice/blob/main/examples/music-bot/src/music/subscription.ts
 */

import {EventEmitter} from 'events';
import {
  AudioPlayer,
  AudioPlayerStatus,
  AudioResource,
  createAudioPlayer,
  createAudioResource,
  entersState,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
  VoiceConnectionDisconnectReason,
} from '@discordjs/voice';
import {StageChannel, VoiceChannel} from 'discord.js';
import {promisify} from 'util';
import {Readable} from 'stream';
import {
  StreamConnectionEvents, Song, DMPError, DMPErrors,
} from '../index';

const wait = promisify(setTimeout);

export class StreamConnection extends EventEmitter {
  public readonly connection: VoiceConnection;

  public readonly player: AudioPlayer;

  public channel: VoiceChannel | StageChannel;

  public resource?: AudioResource<Song>;

  public paused = false;

  private readyLock = false;

  /**
   * StreamConnection constructor
   * @param {VoiceConnection} connection
   * @param {VoiceChannel|StageChannel} channel
   */
  constructor(connection: VoiceConnection, channel: VoiceChannel | StageChannel) {
    super();

    /**
     * The VoiceConnection
     * @type {VoiceConnection}
     */
    this.connection = connection;

    /**
     * The AudioPlayer
     * @type {AudioPlayer}
     */
    this.player = createAudioPlayer();

    /**
     * The VoiceChannel or StageChannel
     * @type {VoiceChannel | StageChannel}
     */
    this.channel = channel;

    this.connection.on('stateChange', async (oldState, newState) => {
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        if (newState.reason === VoiceConnectionDisconnectReason.WebSocketClose && newState.closeCode === 4014) {
          try {
            await entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000);
          } catch {
            this.leave();
          }
        } else if (this.connection.rejoinAttempts < 5) {
          await wait((this.connection.rejoinAttempts + 1) * 5_000);
          this.connection.rejoin();
        } else {
          this.leave();
        }
      } else if (newState.status === VoiceConnectionStatus.Destroyed) {
        this.stop();
      } else if (
        !this.readyLock
        && (newState.status === VoiceConnectionStatus.Connecting || newState.status === VoiceConnectionStatus.Signalling)
      ) {
        this.readyLock = true;
        try {
          await this._enterState();
        } catch {
          if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.leave();
        } finally {
          this.readyLock = false;
        }
      }
    });

    this.player
      .on('stateChange', (oldState, newState) => {
        if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
          if (!this.paused) {
            this.emit('end', this.resource);
            delete this.resource;
          }
        } else if (newState.status === AudioPlayerStatus.Playing) {
          if (!this.paused) {
            this.emit('start', this.resource);
          }
        }
      })
      .on('error', (data) => {
        this.emit('error', data);
      });

    this.connection.subscribe(this.player);
  }

  /**
   * Gets the current volume
   * @type {number}
   */
  public get volume(): number {
    if (!this.resource?.volume) return 100;
    const currentVol = this.resource.volume.volume;
    return Math.round((currentVol ** (1 / 1.661)) * 200);
  }

  /**
   * Gets the stream time
   * @type {number}
   */
  public get time(): number {
    if (!this.resource) return 0;
    return this.resource.playbackDuration;
  }

  /**
   *
   * @param {Readable | string} stream
   * @param {{ inputType: StreamType, metadata: any|undefined }} options
   * @returns {AudioResource<Song>}
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public createAudioStream(stream: string | Readable, options: { inputType: StreamType, metadata?: any }): AudioResource<Song> {
    this.resource = createAudioResource(stream, {
      inputType: options.inputType,
      inlineVolume: true,
      metadata: options.metadata,
    });

    return this.resource;
  }

  /**
   * Pauses/Resumes the connection
   * @param {boolean} state
   * @returns {boolean}
   */
  public setPauseState(state: boolean) {
    if (state) {
      this.player.pause(true);
      this.paused = true;
      return true;
    }
    this.player.unpause();
    this.paused = false;
    return false;
  }

  /**
   * Stops and ends the connection
   * @returns {boolean}
   */
  public stop() {
    return this.player.stop();
  }

  /**
   * Disconnect and leave from the voice channel
   * @returns {void}
   */
  public leave() {
    try {
      this.player.stop(true);
      this.connection.destroy();
      // eslint-disable-next-line no-empty
    } catch (_) {
    }
  }

  /**
   * Sets the current volume
   * @param {number} volume
   * @returns {boolean}
   */
  public setVolume(volume: number): boolean {
    if (!this.resource || this.isInvalidVolume(volume)) return false;

    this.resource.volume?.setVolumeLogarithmic(volume / 200);
    return true;
  }

  /**
   *
   * @param {AudioResource<Song>} resource
   * @returns {Promise<StreamConnection>}
   */
  public async playAudioStream(resource: AudioResource<Song>): Promise<this> {
    if (!resource) throw new DMPError(DMPErrors.RESOURCE_NOT_READY);
    if (!this.resource) this.resource = resource;

    if (this.connection.state.status !== VoiceConnectionStatus.Ready) await this._enterState();

    this.player.play(resource);

    return this;
  }

  /**
   * @returns {void}
   * @private
   */
  private async _enterState() {
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
  }

  /**
   *
   * @param {number} volume
   * @returns {boolean}
   * @private
   */
  private isInvalidVolume(volume: number) {
    return (
      isNaN(volume)
      || volume >= Infinity
      || volume < 0);
  }
}

export declare interface StreamConnection {
  on<K extends keyof StreamConnectionEvents>(event: K, listener: (...args: StreamConnectionEvents[K]) => void): this;
}
