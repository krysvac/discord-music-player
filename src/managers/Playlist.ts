import {User} from 'discord.js';
import {Player, Queue, RawPlaylist, Song} from '..';

export class Playlist {
  public player: Player;
  public queue: Queue;
  public name: string;
  public author: string;
  public url: string;
  public songs: Song[];
  public requestedBy?: User;

  /**
   * Playlist constructor
   * @param {RawPlaylist} raw
   * @param {Queue} queue
   * @param {User} [requestedBy]
   */
  constructor(raw: RawPlaylist, queue: Queue, requestedBy?: User) {

    /**
     * Player instance
     * @name Playlist#player
     * @type {Player}
     * @readonly
     */

    /**
     * Playlist queue
     * @name Playlist#queue
     * @type {Queue}
     */

    /**
     * Playlist name
     * @name Playlist#name
     * @type {string}
     */

    /**
     * Playlist author
     * @name Playlist#author
     * @type {string}
     */

    /**
     * Playlist url
     * @name Playlist#url
     * @type {string}
     */

    /**
     * Playlist songs
     * @name Playlist#songs
     * @type {string}
     */

    /**
     * Playlist requested by user
     * @name Playlist#requestedBy
     * @type {User}
     */

    this.player = queue.player;

    this.queue = queue;

    this.name = raw.name;

    this.author = raw.author;

    this.url = raw.url;

    this.songs = raw.songs;

    this.requestedBy = requestedBy;
  }

  /**
   * Playlist name and author in string representation
   * @returns {string}
   */
  public toString(): string {
    return `${this.name} | ${this.author}`;
  }
}
