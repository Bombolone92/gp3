// Original icons for geometry nodes and the spreadsheet (16×16 grid, theme-colored classes).
import { registerIcons } from '../ui/icons';

registerIcons({
  gn_attribute:
    '<rect class="s" x="2.5" y="3.5" width="11" height="9" rx="1" fill="none" stroke-width="1.2"/><path class="s" d="M2.5 6.5h11M6.5 3.5v9" stroke-width="1.1"/><rect class="f" x="3" y="7" width="3" height="5" opacity=".7"/>',
  ss_vertex: '<path class="s" d="M8 8 3 12.5M8 8l5 4.5M8 8V2" stroke-width="1.2" opacity=".5"/><circle class="f" cx="8" cy="8" r="2.4"/>',
  ss_edge: '<circle class="f" cx="3.5" cy="12.5" r="1.6" opacity=".55"/><circle class="f" cx="12.5" cy="3.5" r="1.6" opacity=".55"/><path class="s" d="M3.5 12.5 12.5 3.5" stroke-width="2"/>',
  ss_face: '<path class="f" d="M3 4h10l-2 9H5z" opacity=".85"/>',
  ss_corner: '<path class="s" d="M3 4h10l-2 9H5z" fill="none" stroke-width="1.1" opacity=".55"/><path class="f" d="M3 4h4.5L6.4 6.6 4 8.5z"/>',
  ss_point: '<circle class="f" cx="8" cy="8" r="3"/>',
  ss_control_point: '<path class="s" d="M2 12C4 4 12 4 14 12" fill="none" stroke-width="1.2" opacity=".55"/><circle class="f" cx="8" cy="6" r="2.2"/>',
  ss_spline: '<path class="s" d="M2 12C4 4 12 4 14 12" fill="none" stroke-width="1.8"/>',
  ss_instance: '<rect class="s" x="2.5" y="5.5" width="7" height="7" fill="none" stroke-width="1.2"/><rect class="f" x="6.5" y="2.5" width="7" height="7" opacity=".85"/>',
});
