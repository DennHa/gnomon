// Changes that may need saying afterwards: what a leave-time correction cut (with Undo), and hours that found no room.
import { cutNote, undoCut } from './actions';
import { useStore } from './store';
import { entryMs, fmtHM, fmtTime } from './time';
import { t } from './i18n';
import type { Data } from './types';

/** Runs a change to a day's leave time; if it cut entries, says so with Undo. */
export function useLeaveEdit() {
  const { getData, commit, showNote } = useStore();
  return (date: string, fn: (d: Data) => Data) => {
    const before = getData();
    const after = fn(before);
    commit(after);
    const cut = cutNote(before, after, date);
    if (cut) showNote({ text: cut.end ? t('cut.note', { time: fmtTime(cut.end), duration: fmtHM(cut.ms) }) : t('cut.noteTimer', { duration: fmtHM(cut.ms) }), undo: () => commit(undoCut(getData(), cut)) });
  };
}

/** Runs a change that adds `wanted` ms of entries; says how much found no room (see freeStart in src/actions.ts). */
export function useAddHours() {
  const { getData, commit, showNote } = useStore();
  return (wanted: number, fn: (d: Data) => Data) => {
    const before = getData();
    const after = fn(before);
    commit(after);
    const known = new Set(before.entries.map((e) => e.id));
    const added = after.entries.filter((e) => !known.has(e.id)).reduce((s, e) => s + entryMs(e), 0);
    if (wanted - added >= 60_000) showNote({ text: t('place.noRoom', { duration: fmtHM(wanted - added) }) });
  };
}
