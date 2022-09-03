import {
  ChannelType,
  Guild, GuildChannelResolvable, StageChannel, VoiceChannel,
} from 'discord.js';
import {
  AudioResource,
  entersState, joinVoiceChannel, StreamType, VoiceConnectionStatus,
} from '@discordjs/voice';
import ytdl from 'discord-ytdl-core';
import {StreamConnection} from '../voice/StreamConnection';
import {
  Playlist,
  Song,
  Player,
  Utils,
  DefaultPlayerOptions,
  PlayerOptions,
  PlayOptions,
  PlaylistOptions,
  RepeatMode,
  ProgressBarOptions,
  ProgressBar,
  DMPError,
  DMPErrors,
  DefaultPlayOptions,
  DefaultPlaylistOptions,
} from '..';
import _ from 'lodash';

export class Queue {
  public player: Player;

  public guild: Guild;

  public connection: StreamConnection | undefined;

  public songs: Song[] = [];

  public isPlaying = false;

  public data?: any = null;

  public options: PlayerOptions = DefaultPlayerOptions;

  public repeatMode: RepeatMode = RepeatMode.DISABLED;

  public destroyed = false;

  /**
   * Queue constructor
   * @param {Player} player
   * @param {Guild} guild
   * @param {PlayerOptions} options
   */
  constructor(player: Player, guild: Guild, options?: PlayerOptions) {
    /**
     * Player instance
     * @name Queue#player
     * @type {Player}
     * @readonly
     */

    /**
     * Guild instance
     * @name Queue#guild
     * @type {Guild}
     * @readonly
     */

    /**
     * Queue options
     * @name Queue#options
     * @type {PlayerOptions}
     */

    this.player = player;

    this.guild = guild;

    this.options = Object.assign(
      {} as PlayerOptions,
      options,
    );
  }

  /**
   * Gets the current volume
   * @type {number}
   */
  public get volume(): number {
    if (!this.connection) return DefaultPlayerOptions.volume!;
    return this.connection.volume;
  }

  /**
   * Gets the paused state of the player
   * @type {boolean}
   */
  public get paused(): boolean {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);
    if (!this.connection) throw new DMPError(DMPErrors.NO_VOICE_CONNECTION);
    if (!this.isPlaying) throw new DMPError(DMPErrors.NOTHING_PLAYING);

    return this.connection.paused;
  }

  /**
   * Returns current playing song
   * @type {?Song}
   */
  public get nowPlaying(): Song | undefined {
    return this.connection?.resource?.metadata ?? this.songs[0];
  }

  /**
   * Joins a voice channel
   * @param {GuildChannelResolvable} channelId
   * @returns {Promise<Queue>}
   */
  public async join(channelId: GuildChannelResolvable) {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);

    if (this.connection) return this;
    const channel = this.guild.channels.resolve(channelId) as StageChannel | VoiceChannel;
    if (!channel) throw new DMPError(DMPErrors.UNKNOWN_VOICE);
    if (channel.type !== ChannelType.GuildVoice) throw new DMPError(DMPErrors.CHANNEL_TYPE_INVALID);
    let connection = joinVoiceChannel({
      guildId: channel.guild.id,
      channelId: channel.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: this.options.deafenOnJoin,
    });
    let _connection: StreamConnection;
    try {
      connection = await entersState(connection, VoiceConnectionStatus.Ready, 15 * 1000);
      _connection = new StreamConnection(connection, channel);
    } catch (err) {
      connection.destroy();
      throw new DMPError(DMPErrors.VOICE_CONNECTION_ERROR);
    }
    this.connection = _connection;

    this.connection
      .on('start', (resource) => {
        this.isPlaying = true;
        if (resource?.metadata?.isFirst && resource?.metadata?.seekTime === 0) this.player.emit('songFirst', this, this.nowPlaying);
      })
      .on('end', async (_) => {
        if (this.destroyed) {
          this.player.emit('queueDestroyed', this);
          return;
        }
        this.isPlaying = false;
        const oldSong = this.songs.shift();
        if (this.songs.length === 0 && this.repeatMode === RepeatMode.DISABLED) {
          this.player.emit('queueEnd', this);
          if (this.options.leaveOnEnd) {
            setTimeout(() => {
              if (!this.isPlaying) this.destroy();
            }, this.options.timeout);
          }
        } else {
          if (this.repeatMode === RepeatMode.SONG) {
            this.songs.unshift(oldSong!);
            this.songs[0].setFirst(false);
            this.player.emit('songChanged', this, this.songs[0], oldSong);
            return this.play(this.songs[0] as Song, {immediate: true});
          }
          if (this.repeatMode === RepeatMode.QUEUE) {
            this.songs.push(oldSong!);
            this.songs[this.songs.length - 1].setFirst(false);
            this.player.emit('songChanged', this, this.songs[0], oldSong);
            return this.play(this.songs[0] as Song, {immediate: true});
          }

          this.player.emit('songChanged', this, this.songs[0], oldSong);
          return this.play(this.songs[0] as Song, {immediate: true});
        }
      })
      .on('error', (err) => this.player.emit('error', err.message, this));
    return this;
  }

  /**
   * Plays or Queues a song (in a VoiceChannel)
   * @param {Song | string} search
   * @param {PlayOptions} [options=DefaultPlayOptions]
   * @returns {Promise<Song>}
   */
  public async play(search: Song | string, options: PlayOptions & { immediate?: boolean, seek?: number, data?: any } = DefaultPlayOptions): Promise<Song> {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);
    if (!this.connection) throw new DMPError(DMPErrors.NO_VOICE_CONNECTION);
    options = Object.assign(
      {} as PlayOptions,
      DefaultPlayOptions,
      options,
    );
    const {data} = options;
    delete options.data;
    let song = await Utils.best(search, options, this)
      .catch((error) => {
        throw new DMPError(error);
      });
    if (!options.immediate) song.data = data;

    const songLength = this.songs.length;

    if (options.playNext) {
      if (songLength === 0) { // If we have no songs then do nothing since it's the same as just playing normally
      } else { // If we have some songs already
        if (options.addToEndOfPn) {
          const indexOfLastPn = _.findLastIndex(this.songs, song => {
            return song.type === 'playNext';
          });

          if (indexOfLastPn === -1) { // No pn songs at all, add to top of array after current song
            options.index = 0;
          } else { // One or more pn songs exist
            if (indexOfLastPn === songLength - 1) { // If the last pn song is the last item of the array, add the song regularly
            } else {
              options.index = indexOfLastPn;
            }
          }
        } else {
          options.index = 0;
        }
      }
    }

    if (!options?.immediate && songLength !== 0) {
      if (options.index! >= 0 && ++options.index! <= songLength) {
        this.songs.splice(options.index!, 0, song);
      } else {
        this.songs.push(song);
      }
      this.player.emit('songAdd', this, song);
      return song;
    }
    if (!options?.immediate) {
      song.setFirst();
      if (options.index! >= 0 && ++options.index! <= songLength) {
        this.songs.splice(options.index!, 0, song);
      } else {
        this.songs.push(song);
      }
      this.player.emit('songAdd', this, song);
    } else if (options.seek) {
      this.songs[0].seekTime = options.seek;
    }

    const {quality} = this.options;
    song = this.songs[0];
    if (song.seekTime) {
      options.seek = song.seekTime;
    }

    const stream = ytdl(song.url, {
      requestOptions: this.player.options.ytdlRequestOptions ?? {},
      opusEncoded: false,
      seek: options.seek ? options.seek / 1000 : 0,
      fmt: 's16le',
      encoderArgs: [],
      quality: quality!.toLowerCase() === 'low' ? 'lowestaudio' : 'highestaudio',
      highWaterMark: 1 << 25,
      filter: 'audioonly',
    })
      .on('error', (error: { message: string; }) => {
        if (!/Status code|premature close/i.test(error.message)) this.player.emit('error', error.message === 'Video unavailable' ? 'VideoUnavailable' : error.message, this);
      });

    const resource: AudioResource<Song> = this.connection.createAudioStream(stream, {
      metadata: song,
      inputType: StreamType.Raw,
    });

    await this.connection!.playAudioStream(resource).then(() => {
      this.setVolume(this.options.volume!);
    });

    return song;
  }

  /**
   * Plays or Queues a playlist (in a VoiceChannel)
   * @param {Playlist | string} search
   * @param {PlaylistOptions} [options=DefaultPlaylistOptions]
   * @returns {Promise<Playlist>}
   */
  public async playlist(search: Playlist | string, options: PlaylistOptions & { data?: any } = DefaultPlaylistOptions): Promise<Playlist> {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);
    if (!this.connection) throw new DMPError(DMPErrors.NO_VOICE_CONNECTION);
    options = Object.assign(
      {} as PlaylistOptions & { data?: any },
      DefaultPlaylistOptions,
      options,
    );
    const playlist = await Utils.playlist(search, options, this)
      .catch((error) => {
        throw new DMPError(error);
      });
    const songLength = this.songs.length;

    if (options.playNext) {
      if (songLength === 0) { // If we have no songs then add the pn songs regularly since it doesn't matter
        this.songs.push(...playlist.songs);
      } else { // If we have some songs already
        if (options.addToEndOfPn) {
          const indexOfLastPn = _.findLastIndex(this.songs, song => {
            return song.type === 'playNext';
          });

          if (indexOfLastPn === -1) { // No pn songs at all, add to top of array after current song
            this.songs.splice(1, 0, ...playlist.songs);
          } else { // One or more pn songs exist
            if (indexOfLastPn === songLength - 1) { // If the last pn song is the last item of the array, add the songs regularly
              this.songs.push(...playlist.songs);
            } else {
              this.songs.splice(indexOfLastPn + 1, 0, ...playlist.songs);
            }
          }
        } else { // add on top of any queued songs
          this.songs.splice(1, 0, ...playlist.songs);
        }
      }
    } else {
      this.songs.push(...playlist.songs);
    }
    this.player.emit('playlistAdd', this, playlist);

    if (songLength === 0) {
      playlist.songs[0].setFirst();
      await this.play(playlist.songs[0], {immediate: true});
    }

    return playlist;
  }

  /**
   * Seeks the current playing Song
   * @param {number} time
   * @returns {boolean}
   */
  public async seek(time: number) {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);
    if (!this.isPlaying) throw new DMPError(DMPErrors.NOTHING_PLAYING);

    if (isNaN(time)) return;
    if (time < 1) time = 0;
    if (time >= this.nowPlaying!.milliseconds) return this.skip();

    await this.play(this.nowPlaying!, {
      immediate: true,
      seek: time,
    });

    return true;
  }

  /**
   * Skips the current playing Song and returns it
   * @param {number} [index=0]
   * @returns {Song}
   */
  public skip(index = 0): Song {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);
    if (!this.connection) throw new DMPError(DMPErrors.NO_VOICE_CONNECTION);
    this.songs.splice(1, index);

    const skippedSong = this.songs[0];
    this.connection.stop();
    return skippedSong;
  }

  /**
   * Stops playing the Music and cleans the Queue
   * @returns {void}
   */
  public stop(): void {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);

    return this.destroy();
  }

  /**
   * Shuffles the Queue
   * @returns {Song[]}
   */
  public shuffle(): Song[] | undefined {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);

    const currentSong = this.songs.shift();
    this.songs = Utils.shuffle(this.songs);
    this.songs.unshift(currentSong!);

    return this.songs;
  }

  /**
   * Pause/resume the current Song
   * @param {boolean} [state=true] Pause state, if none it will pause the Song
   * @returns {boolean}
   */
  public setPaused(state = true): boolean | undefined {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);
    if (!this.connection) throw new DMPError(DMPErrors.NO_VOICE_CONNECTION);
    if (!this.isPlaying) throw new DMPError(DMPErrors.NOTHING_PLAYING);

    return this.connection.setPauseState(state);
  }

  /**
   * Remove a Song from the Queue
   * @param {number} index
   * @returns {Song|undefined}
   */
  public remove(index: number): Song | undefined {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);

    return this.songs.splice(index, 1)[0];
  }

  /**
   * Sets the current volume
   * @param {number} volume
   * @returns {boolean}
   */
  public setVolume(volume: number) {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);
    if (!this.connection) throw new DMPError(DMPErrors.NO_VOICE_CONNECTION);

    this.options.volume = volume;
    return this.connection.setVolume(volume);
  }

  /**
   * Clears the Queue
   * @returns {void}
   */
  public clearQueue() {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);

    const currentlyPlaying = this.songs.shift();
    this.songs = [currentlyPlaying!];
  }

  /**
   * Sets Queue repeat mode
   * @param {RepeatMode} repeatMode
   * @returns {boolean}
   */
  public setRepeatMode(repeatMode: RepeatMode): boolean {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);

    if (![RepeatMode.DISABLED, RepeatMode.QUEUE, RepeatMode.SONG].includes(repeatMode)) throw new DMPError(DMPErrors.UNKNOWN_REPEAT_MODE);
    if (repeatMode === this.repeatMode) return false;
    this.repeatMode = repeatMode;
    return true;
  }

  /**
   * Creates Progress Bar class
   * @param {ProgressBarOptions} [options]
   * @returns {ProgressBar}
   */
  public createProgressBar(options?: ProgressBarOptions): ProgressBar {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);
    if (!this.isPlaying) throw new DMPError(DMPErrors.NOTHING_PLAYING);

    return new ProgressBar(this, options);
  }

  /**
   * Set's custom queue data
   * @param {any} data
   * @returns {void}
   */
  public setData(data: any): void {
    if (this.destroyed) throw new DMPError(DMPErrors.QUEUE_DESTROYED);

    this.data = data;
  }

  /**
   * Destroys the queue
   * @param {boolean} leaveOnStop
   * @returns {void}
   * @private
   */
  public destroy(leaveOnStop = this.options.leaveOnStop) {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.connection) this.connection.stop();
    if (leaveOnStop) {
      setTimeout(() => {
        this.connection?.leave();
      }, this.options?.timeout ? this.options.timeout : 0);
    }
    this.player.deleteQueue(this.guild.id);
  }
}
