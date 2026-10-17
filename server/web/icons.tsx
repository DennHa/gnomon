// Material Symbols (rounded), inlined so the app works offline and without a font request.
import play_arrow from '@material-symbols/svg-400/rounded/play_arrow-fill.svg';
import stop from '@material-symbols/svg-400/rounded/stop-fill.svg';
import coffee from '@material-symbols/svg-400/rounded/coffee.svg';
import login from '@material-symbols/svg-400/rounded/login.svg';
import logout from '@material-symbols/svg-400/rounded/logout.svg';
import today from '@material-symbols/svg-400/rounded/today.svg';
import calendar_view_week from '@material-symbols/svg-400/rounded/calendar_view_week.svg';
import devices from '@material-symbols/svg-400/rounded/devices.svg';
import chevron_left from '@material-symbols/svg-400/rounded/chevron_left.svg';
import chevron_right from '@material-symbols/svg-400/rounded/chevron_right.svg';
import close from '@material-symbols/svg-400/rounded/close.svg';
import delete_ from '@material-symbols/svg-400/rounded/delete.svg';
import history from '@material-symbols/svg-400/rounded/history.svg';
import add from '@material-symbols/svg-400/rounded/add.svg';
import cloud_off from '@material-symbols/svg-400/rounded/cloud_off.svg';
import timer from '@material-symbols/svg-400/rounded/timer.svg';
import schedule from '@material-symbols/svg-400/rounded/schedule.svg';

const ICONS = { play_arrow, stop, coffee, login, logout, today, calendar_view_week, devices, chevron_left, chevron_right, close, delete: delete_, history, add, cloud_off, timer, schedule };
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return <span className="icon" style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}
