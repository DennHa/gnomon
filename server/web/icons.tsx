// Material Symbols (rounded), inlined so the app works offline and without a font request.
import play_arrow from '@material-symbols/svg-400/rounded/play_arrow-fill.svg';
import stop from '@material-symbols/svg-400/rounded/stop-fill.svg';
import coffee from '@material-symbols/svg-400/rounded/coffee.svg';
import login from '@material-symbols/svg-400/rounded/login.svg';
import logout from '@material-symbols/svg-400/rounded/logout.svg';
import today from '@material-symbols/svg-400/rounded/today.svg';
import calendar_view_week from '@material-symbols/svg-400/rounded/calendar_view_week.svg';
import devices from '@material-symbols/svg-400/rounded/devices.svg';
import laptop_mac from '@material-symbols/svg-400/rounded/laptop_mac.svg';
import mobile from '@material-symbols/svg-400/rounded/mobile.svg';
import language from '@material-symbols/svg-400/rounded/language.svg';
import edit from '@material-symbols/svg-400/rounded/edit.svg';
import link_off from '@material-symbols/svg-400/rounded/link_off.svg';
import qr_code_2 from '@material-symbols/svg-400/rounded/qr_code_2.svg';
import forum from '@material-symbols/svg-400/rounded/forum.svg';
import person from '@material-symbols/svg-400/rounded/person.svg';
import send from '@material-symbols/svg-400/rounded/send.svg';
import chevron_left from '@material-symbols/svg-400/rounded/chevron_left.svg';
import chevron_right from '@material-symbols/svg-400/rounded/chevron_right.svg';
import close from '@material-symbols/svg-400/rounded/close.svg';
import delete_ from '@material-symbols/svg-400/rounded/delete.svg';
import history from '@material-symbols/svg-400/rounded/history.svg';
import add from '@material-symbols/svg-400/rounded/add.svg';
import cloud_off from '@material-symbols/svg-400/rounded/cloud_off.svg';
import timer from '@material-symbols/svg-400/rounded/timer.svg';
import schedule from '@material-symbols/svg-400/rounded/schedule.svg';
import qr_code_scanner from '@material-symbols/svg-400/rounded/qr_code_scanner.svg';
import check_circle from '@material-symbols/svg-400/rounded/check_circle.svg';
import download from '@material-symbols/svg-400/rounded/download.svg';
import link from '@material-symbols/svg-400/rounded/link.svg';
import warning from '@material-symbols/svg-400/rounded/warning.svg';
import arrow_forward from '@material-symbols/svg-400/rounded/arrow_forward.svg';
import arrow_back from '@material-symbols/svg-400/rounded/arrow_back.svg';
import rocket_launch from '@material-symbols/svg-400/rounded/rocket_launch.svg';
import lock from '@material-symbols/svg-400/rounded/lock.svg';
import verified_user from '@material-symbols/svg-400/rounded/verified_user.svg';
import apartment from '@material-symbols/svg-400/rounded/apartment.svg';
import group from '@material-symbols/svg-400/rounded/group.svg';
import mail from '@material-symbols/svg-400/rounded/mail.svg';

const ICONS = { play_arrow, stop, coffee, login, logout, today, calendar_view_week, devices, laptop_mac, mobile, language, edit, link_off, qr_code_2, forum, send, person, chevron_left, chevron_right, close, delete: delete_, history, add, cloud_off, timer, schedule, qr_code_scanner, check_circle, download, link, warning, arrow_forward, arrow_back, rocket_launch, lock, verified_user, apartment, group, mail };
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return <span className="icon" style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}
