// Viewer node and the geometry node group type.
import { gn, sprop } from './defs';
import { valueSocket } from './geometry';
import { makeGroupNodeType, groupNodeIdnames } from '../../nodes/common';
import { fieldTypeOfEnum } from '../types';
import type { NodeData } from '../../data/types';

export const VIEWER = 'GeometryNodeViewer';
export const VIEWER_TYPES = ['FLOAT', 'INT', 'BOOLEAN', 'FLOAT_VECTOR', 'FLOAT_COLOR', 'QUATERNION'];

/** Whether a viewer node is the active one of its tree. */
export const isActiveViewer = (n: NodeData) => n.type === VIEWER && !!n.props.viewer_active && !n.mute;

gn(
  VIEWER,
  'output',
  // evaluated by the modifier when active (see modifier.ts); nothing flows out of it
  { exec: () => ({}) },
  {
    drop: ['active_index', 'ui_shortcut'],
    props: [
      {
        id: 'domain',
        name: 'Domain',
        type: 'ENUM',
        items: [
          ['AUTO', 'Auto'],
          ['POINT', 'Point'],
          ['EDGE', 'Edge'],
          ['FACE', 'Face'],
          ['CORNER', 'Face Corner'],
          ['CURVE', 'Spline'],
          ['INSTANCE', 'Instance'],
        ],
        d: 'AUTO',
        noLabel: true,
      },
      {
        id: 'data_type',
        name: 'Data Type',
        type: 'ENUM',
        items: [
          ['FLOAT', 'Float'],
          ['INT', 'Integer'],
          ['BOOLEAN', 'Boolean'],
          ['FLOAT_VECTOR', 'Vector'],
          ['FLOAT_COLOR', 'Color'],
          ['QUATERNION', 'Rotation'],
        ],
        d: 'FLOAT',
        noLabel: true,
      },
    ],
    dynamicSockets: (node) => ({
      inputs: [
        { name: 'Geometry', identifier: 'Geometry', type: 'GEOMETRY' },
        {
          ...valueSocket('Value', fieldTypeOfEnum(sprop(node, 'data_type') || 'FLOAT')),
          hide_value: true,
        },
      ],
      outputs: [],
    }),
    description: 'Display the input data in the Spreadsheet Editor and the 3D viewport',
  },
);

makeGroupNodeType('GeometryNodeGroup', ['GEOMETRY']);
groupNodeIdnames.GEOMETRY = 'GeometryNodeGroup';
