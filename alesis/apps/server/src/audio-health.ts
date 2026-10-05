type HealthObserver = (ready: boolean, reason?: string) => void;

export function createAudioHealthObserver(isCurrent: () => boolean, report: HealthObserver): HealthObserver {
  return (ready, reason) => {
    if (!isCurrent()) return;
    report(ready, reason);
  };
}
