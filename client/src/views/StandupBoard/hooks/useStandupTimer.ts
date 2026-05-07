// useStandupTimer.ts — React timer hook for the 15-minute standup timebox.

import { useCallback, useEffect, useState } from 'react';

export const STANDUP_TIMER_TOTAL_SECONDS = 15 * 60;
const TIMER_TICK_MILLISECONDS = 1000;
const LAST_SECOND = 1;

export interface UseStandupTimer {
  remainingSeconds: number;
  isRunning: boolean;
  start: () => void;
  pause: () => void;
  reset: () => void;
}

/** Owns the standup countdown so the view can present start, pause, resume, and reset controls. */
export function useStandupTimer(): UseStandupTimer {
  const [remainingSeconds, setRemainingSeconds] = useState<number>(STANDUP_TIMER_TOTAL_SECONDS);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  useEffect(() => {
    if (!isRunning) return undefined;

    const intervalId = window.setInterval(() => {
      setRemainingSeconds((currentRemainingSeconds) => {
        if (currentRemainingSeconds <= LAST_SECOND) {
          setIsRunning(false);
          return 0;
        }

        return currentRemainingSeconds - 1;
      });
    }, TIMER_TICK_MILLISECONDS);

    return () => window.clearInterval(intervalId);
  }, [isRunning]);

  const start = useCallback(() => {
    setIsRunning(true);
  }, []);

  const pause = useCallback(() => {
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    setRemainingSeconds(STANDUP_TIMER_TOTAL_SECONDS);
    setIsRunning(false);
  }, []);

  return { remainingSeconds, isRunning, start, pause, reset };
}
