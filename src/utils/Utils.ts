import {
  Song, Queue, Playlist,
  PlayOptions, PlaylistOptions, DMPErrors,
  DefaultPlayOptions, DefaultPlaylistOptions,
  RawSong, RawPlaylist,
} from "..";
import YTSR, {Video} from 'ytsr';
import {getSong, getPlaylist} from "./AppleUtils";
import {Client, Video as IVideo, VideoCompact, Playlist as IPlaylist} from "youtubei";

let YouTube = new Client();

export class Utils {
  private static regexList = {
    // eslint-disable-next-line no-useless-escape
    YouTubeVideo: /^((?:https?:)\/\/)?((?:www|m)\.)?((?:youtube\.com|youtu.be))((?!channel)(?!user)\/(?:[\w\-]+\?v=|embed\/|v\/)?)((?!channel)(?!user)[\w\-]+)(((.*(\?|\&)t=(\d+))(\D?|\S+?))|\D?|\S+?)$/,
    YouTubeVideoID: /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/,
    YouTubePlaylist: /^((?:https?:)\/\/)?((?:www|m)\.)?((?:youtube\.com)).*(youtu.be\/|list=)([^#&?]*).*/,
    YouTubePlaylistID: /[&?]list=([^&]+)/,
    Spotify: /https?:\/\/(?:embed\.|open\.)(?:spotify\.com\/)(?:track\/|\?uri=spotify:track:)((\w|-)+)(?:(?=\?)(?:[?&]foo=(\d*)(?=[&#]|$)|(?![?&]foo=)[^#])+)?(?=#|$)/,
    SpotifyPlaylist: /https?:\/\/(?:embed\.|open\.)(?:spotify\.com\/)(?:(album|playlist)\/|\?uri=spotify:playlist:)((\w|-)+)(?:(?=\?)(?:[?&]foo=(\d*)(?=[&#]|$)|(?![?&]foo=)[^#])+)?(?=#|$)/,
    Apple: /https?:\/\/music\.apple\.com\/.+?\/.+?\/(.+?)\//,
    ApplePlaylist: /https?:\/\/music\.apple\.com\/.+?\/.+?\/(.+?)\//,
  }

  /**
   *
   */
  private constructor() {
  }

  /**
   * Gets the best result of a Search
   * @param {Song|string} Search
   * @param {PlayOptions} SOptions
   * @param {Queue} Queue
   * @return {Promise<Song>}
   */
  public static async best(Search: Song | string, SOptions: PlayOptions = DefaultPlayOptions, Queue: Queue): Promise<Song> {
    let _Song;

    if (Search instanceof Song)
      return Search as Song;

    _Song = await this.link(
      Search,
      SOptions,
      Queue
    );

    if (!_Song)
      _Song = (await this.search(
        Search,
        SOptions,
        Queue
      ))[0];

    return _Song;
  }

  /**
   * Search for Playlist
   * @param {string} Search
   * @param {PlaylistOptions} SOptions
   * @param {Queue} Queue
   * @return {Promise<Playlist>}
   */
  public static async playlist(Search: Playlist | string, SOptions: PlaylistOptions & { data?: any } = DefaultPlaylistOptions, Queue: Queue): Promise<Playlist> {
    if (Search instanceof Playlist)
      return Search as Playlist;

    const Limit = SOptions.maxSongs ?? -1;
    const SpotifyPlaylistLink =
      this.regexList.SpotifyPlaylist.test(Search);
    const YouTubePlaylistLink =
      this.regexList.YouTubePlaylist.test(Search);
    const ApplePlaylistLink =
      this.regexList.ApplePlaylist.test(Search);

    if (ApplePlaylistLink) {
      const AppleResultData = await getPlaylist(Search).catch(() => null);
      if (!AppleResultData)
        throw DMPErrors.INVALID_PLAYLIST;

      const AppleResult: RawPlaylist = {
        name: AppleResultData.name,
        author: AppleResultData.author,
        url: Search,
        songs: [],
        type: AppleResultData.type
      }

      AppleResult.songs = (
        await Promise.all(
          AppleResultData.tracks.map(async (track, index) => {
            if (Limit !== -1 && index >= Limit)
              return null;
            const Result = await this.search(
              `${track.artist} - ${track.title}`,
              SOptions,
              Queue
            ).catch(() => null);
            if (Result && Result[0]) {
              Result[0].data = SOptions.data;
              return Result[0];
            } else return null;
          })
        )
      )
        .filter((V): V is Song => V !== null);

      if (AppleResult.songs.length === 0)
        throw DMPErrors.INVALID_PLAYLIST;

      if (SOptions.shuffle)
        AppleResult.songs = this.shuffle(AppleResult.songs);

      return new Playlist(AppleResult, Queue, SOptions.requestedBy);
    } else if (SpotifyPlaylistLink) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fetch = require('isomorphic-unfetch');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getData } = require('spotify-url-info')(fetch)
      const SpotifyResultData = await getData(Search).catch(() => null);
      if (!SpotifyResultData || !['playlist', 'album'].includes(SpotifyResultData.type))
        throw DMPErrors.INVALID_PLAYLIST;

      const SpotifyResult: RawPlaylist = {
        name: SpotifyResultData.name,
        author: SpotifyResultData.type === 'playlist' ? SpotifyResultData.owner.display_name : SpotifyResultData.artists[0].name,
        url: Search,
        songs: [],
        type: SpotifyResultData.type
      }

      SpotifyResult.songs = (
        await Promise.all(
          (SpotifyResultData.tracks?.items ?? []).map(async (track: any, index: number) => {
            if (Limit !== -1 && index >= Limit)
              return null;
            if (SpotifyResult.type === 'playlist')
              track = track.track
            let Result;
            if (!track.artists || !track.artists.length) {
              Result = undefined;
            } else {
              Result = await this.search(
                `${track.artists[0].name} - ${track.name}`,
                SOptions,
                Queue
              ).catch(() => null)
            }

            if (Result) {
              Result[0].data = SOptions.data;
              return Result[0];
            } else return null;
          })
        )
      )
        .filter((V): V is Song => V !== null);

      if (SpotifyResult.songs.length === 0)
        throw DMPErrors.INVALID_PLAYLIST;

      if (SOptions.shuffle)
        SpotifyResult.songs = this.shuffle(SpotifyResult.songs);

      return new Playlist(SpotifyResult, Queue, SOptions.requestedBy);
    } else if (YouTubePlaylistLink) {
      const PlaylistID = this.parsePlaylist(Search);
      if (!PlaylistID)
        throw DMPErrors.INVALID_PLAYLIST;

      YouTube = new Client();
      const YouTubeResultData = await YouTube.getPlaylist(PlaylistID);
      if (!YouTubeResultData || Object.keys(YouTubeResultData).length === 0)
        throw DMPErrors.INVALID_PLAYLIST;

      const YouTubeResult: RawPlaylist = {
        name: YouTubeResultData.title,
        author: YouTubeResultData instanceof IPlaylist ? YouTubeResultData.channel?.name ?? 'YouTube Mix' : 'YouTube Mix',
        url: Search,
        songs: [],
        type: 'playlist'
      }

      if (YouTubeResultData instanceof IPlaylist && YouTubeResultData.videoCount > 100 && (Limit === -1 || Limit > 100))
        await YouTubeResultData.videos.next(Math.floor((Limit === -1 || Limit > YouTubeResultData.videoCount ? YouTubeResultData.videoCount : Limit - 1) / 100));

      YouTubeResult.songs = (YouTubeResultData.videos as VideoCompact[]).map((video: VideoCompact, index: number) => {
        if (Limit !== -1 && index >= Limit)
          return null;
        const song = new Song({
          name: video.title,
          url: `https://youtube.com/watch?v=${video.id}`,
          duration: this.msToTime((video.duration ?? 0) * 1000),
          author: video.channel!.name,
          isLive: video.isLive,
          thumbnail: video.thumbnails.best!,
        }, Queue, SOptions.requestedBy, SOptions.playNext, SOptions.addToEndOfPn);
        song.data = SOptions.data;
        return song;
      })
        .filter((V): V is Song => V !== null);

      if (YouTubeResult.songs.length === 0)
        throw DMPErrors.INVALID_PLAYLIST;

      if (SOptions.shuffle)
        YouTubeResult.songs = this.shuffle(YouTubeResult.songs);

      return new Playlist(YouTubeResult, Queue, SOptions.requestedBy);
    }

    throw DMPErrors.INVALID_PLAYLIST;
  }

  /**
   * Shuffles an array
   * @param {any[]} array
   * @returns {any[]}
   */
  public static shuffle(array: any[]): any[] {
    if (!Array.isArray(array))
      return [];
    const clone = [...array];
    const shuffled = [];
    while (clone.length > 0)
      shuffled.push(
        clone.splice(
          Math.floor(
            Math.random() * clone.length
          ), 1
        )[0]
      );
    return shuffled;
  }

  /**
   * Converts milliseconds to duration (HH:MM:SS)
   * @returns {string}
   */
  public static msToTime(duration: number): string {
    const seconds = Math.floor(duration / 1000 % 60);
    const minutes = Math.floor(duration / 60000 % 60);
    const hours = Math.floor(duration / 3600000);
    const secondsPad = `${seconds}`.padStart(2, '0');
    const minutesPad = `${minutes}`.padStart(2, '0');
    const hoursPad = `${hours}`.padStart(2, '0');

    return `${hours ? `${hoursPad}:` : ''}${minutesPad}:${secondsPad}`;
  }

  /**
   * Converts duration (HH:MM:SS) to milliseconds
   * @returns {number}
   */
  public static timeToMs(duration: string): number {
    return duration.split(':')
      .reduceRight(
        (prev, curr, i, arr) => prev + parseInt(curr, 10) * 60 ** (arr.length - 1 - i), 0
      ) * 1000;
  }

  /**
   * Search for Songs
   * @param {string} Search
   * @param {PlayOptions} [SOptions=DefaultPlayOptions]
   * @param {Queue} Queue
   * @param {number} [Limit=1]
   * @return {Promise<Song[]>}
   */
  private static async search(Search: string, SOptions: PlayOptions = DefaultPlayOptions, Queue: Queue, Limit = 1): Promise<Song[]> {
    SOptions = Object.assign({}, DefaultPlayOptions, SOptions);
    let Filters;

    try {
      // Default Options - Type: Video
      const FiltersTypes = await YTSR.getFilters(Search);
      Filters = FiltersTypes.get('Type')!.get('Video')!;

      // Custom Options - Upload date: null
      if (SOptions?.uploadDate !== null)
        Filters = Array.from(
            (
              await YTSR.getFilters(Filters.url!)
            )
              .get('Upload date')!, ([name, value]) => ({name, url: value.url})
          )
            .find(o => o.name.toLowerCase().includes(SOptions.uploadDate!))
          ?? Filters;

      // Custom Options - Duration: null
      if (SOptions?.duration !== null)
        Filters = Array.from(
            (
              await YTSR.getFilters(Filters.url!)
            )
              .get('Duration')!, ([name, value]) => ({name, url: value.url})
          )
            .find(o => o.name.toLowerCase().startsWith(SOptions.duration!))
          ?? Filters;

      // Custom Options - Sort by: relevance
      if (SOptions?.sortBy !== null && SOptions?.sortBy !== 'relevance')
        Filters = Array.from(
            (
              await YTSR.getFilters(Filters.url!)
            )
              .get('Sort by')!, ([name, value]) => ({name, url: value.url})
          )
            .find(o => o.name.toLowerCase().includes(SOptions.sortBy!))
          ?? Filters;

      const Result = await YTSR(
        Filters.url!,
        {
          limit: Limit,
        }
      );

      const items = Result.items as Video[];

      const songs: (Song | null)[] = items.map(item => {
        if (item?.type?.toLowerCase() !== 'video')
          return null;
        return new Song({
          name: item.title,
          url: item.url,
          duration: item.duration,
          author: item.author!.name,
          isLive: item.isLive,
          thumbnail: item.bestThumbnail.url!,
        } as RawSong, Queue, SOptions.requestedBy, SOptions.playNext, SOptions.addToEndOfPn);
      }).filter(I => I);

      return songs as Song[];
    } catch (e) {
      throw DMPErrors.SEARCH_NULL;
    }
  }

  /**
   * Search for Song via link
   * @param {string} Search
   * @param {PlayOptions} SOptions
   * @param {Queue} Queue
   * @return {Promise<Song>}
   */
  private static async link(Search: string, SOptions: PlayOptions = DefaultPlayOptions, Queue: Queue) {

    const SpotifyLink =
      this.regexList.Spotify.test(Search);
    const YouTubeLink =
      this.regexList.YouTubeVideo.test(Search);
    const AppleLink =
      this.regexList.Apple.test(Search);

    if (AppleLink) {
      try {
        const AppleResult = await getSong(Search);
        const SearchResult = await this.search(
          `${AppleResult.artist} - ${AppleResult.title}`,
          SOptions,
          Queue
        );
        return SearchResult[0];
      } catch (e) {
        throw DMPErrors.INVALID_APPLE;
      }
    } else if (SpotifyLink) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fetch = require('isomorphic-unfetch');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getPreview } = require('spotify-url-info')(fetch)
        const SpotifyResult = await getPreview(Search);
        const SearchResult = await this.search(
          `${SpotifyResult.artist} - ${SpotifyResult.title}`,
          SOptions,
          Queue
        );
        return SearchResult[0];
      } catch (e) {
        throw DMPErrors.INVALID_SPOTIFY;
      }
    } else if (YouTubeLink) {
      const VideoID = this.parseVideo(Search);
      if (!VideoID) throw DMPErrors.SEARCH_NULL;
      YouTube = new Client();
      const VideoResult = await YouTube.getVideo(VideoID) as IVideo;
      if (!VideoResult) throw DMPErrors.SEARCH_NULL;
      const VideoTimecode = this.parseVideoTimecode(Search);

      return new Song({
        name: VideoResult.title,
        url: Search,
        duration: this.msToTime((VideoResult.duration ?? 0) * 1000),
        author: VideoResult.channel.name,
        isLive: VideoResult.isLiveContent,
        thumbnail: VideoResult.thumbnails.best,
        seekTime: SOptions.timecode && VideoTimecode ? Number(VideoTimecode) * 1000 : null,
      } as RawSong, Queue, SOptions.requestedBy, SOptions.playNext, SOptions.addToEndOfPn);
    } else return null;
  }

  /**
   * Get ID from YouTube link
   * @param {string} url
   * @returns {?string}
   */
  private static parseVideo(url: string): string | null {
    const match = url.match(this.regexList.YouTubeVideoID);
    return match ? match[7] : null;
  }

  /**
   * Get timecode from YouTube link
   * @param {string} url
   * @returns {?string}
   */
  private static parseVideoTimecode(url: string): string | null {
    const match = url.match(this.regexList.YouTubeVideo);
    return match ? match[10] : null;
  }

  /**
   * Get ID from Playlist link
   * @param {string} url
   * @returns {?string}
   */
  private static parsePlaylist(url: string): string | null {
    const match = url.match(this.regexList.YouTubePlaylistID);
    return match ? match[1] : null;
  }
}
