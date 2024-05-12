/**
 *  Converts string duration to milliseconds
 *
 * @param {string} duration: Time Duration. The format can be "HH:MM:SS" or "HH:MM:SS.mm"
 * @returns {number}: The converted milliseconds. If the format is wrong, it'll return 0.
 */
export function convertDurationToMilliseconds(duration: string) {
  try {
    const [h, m, s] = duration.split(":");
    const hours = Number.parseInt(h);
    const minutes = Number.parseInt(m);
    const seconds = Number.parseFloat(s);
    const milliseconds =
      hours * 60 * 60 * 1000 + minutes * 60 * 1000 + seconds * 1000;
    return Number.isNaN(milliseconds) ? 0 : milliseconds;
  } catch (_) {
    return 0;
  }
}
