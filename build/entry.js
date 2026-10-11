import MindMap from 'simple-mind-map';
import RichText from 'simple-mind-map/src/plugins/RichText.js';
import Select from 'simple-mind-map/src/plugins/Select.js';
import Drag from 'simple-mind-map/src/plugins/Drag.js';
import KeyboardNavigation from 'simple-mind-map/src/plugins/KeyboardNavigation.js';
MindMap.usePlugin(RichText, Select, Drag, KeyboardNavigation);
export default MindMap;