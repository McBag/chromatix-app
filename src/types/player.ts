/** Parameters passed to each player's init() function. */
export interface PlayerInitParams {
  volumeLevel: number;
  volumeMuted: boolean;
  onLoadStart: () => void;
  onCanPlay: () => void;
  onEnded: () => void;
  onError: (params: { event: Event; playerElement: HTMLAudioElement }) => void;
  /** Another audio source took focus and the player yielded (native player only). */
  onInterruptionStart?: () => void;
  /** Playback came back on its own after an interruption (native player only). */
  onInterruptionEnd?: () => void;
}
