// Original script templates for the Text Editor's Templates menu.

export interface Template {
  name: string;
  file: string;
  language: 'python' | 'javascript';
  body: string;
}

export const templates: Template[] = [
  {
    name: 'Create Objects',
    file: 'create_objects.py',
    language: 'python',
    body: `import bpy
from math import radians, cos, sin

# A ring of cubes around the origin, each with its own material colour.
count = 12
radius = 4.0

for i in range(count):
    angle = radians(360 / count * i)
    bpy.ops.mesh.primitive_cube_add(size=0.6, location=(0, 0, 0.3))
    ob = bpy.context.object
    ob.name = "Ring Cube %02d" % i
    ob.location.x = radius * cos(angle)
    ob.location.y = radius * sin(angle)
    ob.rotation_euler.z = angle

    mat = bpy.data.materials.new("Ring Material %02d" % i)
    hue = i / count
    mat.diffuse_color = (hue, 0.4, 1.0 - hue, 1.0)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (hue, 0.4, 1.0 - hue, 1.0)
    ob.data.materials.append(mat)

print("Created", count, "cubes")
`,
  },
  {
    name: 'Animate Objects',
    file: 'animate_objects.py',
    language: 'python',
    body: `import bpy
from math import sin, pi

# Make the active object bob up and down and spin over the scene frame range.
ob = bpy.context.object
if ob is None:
    raise RuntimeError("Select an object first")

scene = bpy.context.scene
start, end = scene.frame_start, scene.frame_end
steps = 8

for k in range(steps + 1):
    frame = start + (end - start) * k / steps
    ob.location.z = 1.0 + sin(k / steps * 2 * pi)
    ob.rotation_euler.z = k / steps * 2 * pi
    ob.keyframe_insert("location", frame=frame)
    ob.keyframe_insert("rotation_euler", index=2, frame=frame)

scene.frame_set(start)
print("Keyed", ob.name, "on", steps + 1, "frames")
`,
  },
  {
    name: 'Mesh from Data',
    file: 'mesh_from_data.py',
    language: 'python',
    body: `import bpy

# Build a small stepped pyramid directly from vertex and face lists.
verts = []
faces = []
levels = 4
for level in range(levels):
    s = (levels - level) * 0.5
    z = level * 0.5
    base = len(verts)
    verts += [(-s, -s, z), (s, -s, z), (s, s, z), (-s, s, z)]
    verts += [(-s, -s, z + 0.5), (s, -s, z + 0.5), (s, s, z + 0.5), (-s, s, z + 0.5)]
    b, t = base, base + 4
    faces += [(b + 0, b + 1, t + 1, t + 0), (b + 1, b + 2, t + 2, t + 1),
              (b + 2, b + 3, t + 3, t + 2), (b + 3, b + 0, t + 0, t + 3),
              (t + 0, t + 1, t + 2, t + 3), (b + 3, b + 2, b + 1, b + 0)]

mesh = bpy.data.meshes.new("Pyramid")
mesh.from_pydata(verts, [], faces)
mesh.update()

ob = bpy.data.objects.new("Pyramid", mesh)
bpy.context.collection.objects.link(ob)
bpy.context.view_layer.objects.active = ob
print(len(mesh.vertices), "vertices,", len(mesh.polygons), "faces")
`,
  },
  {
    name: 'Operator Simple',
    file: 'operator_simple.py',
    language: 'python',
    body: `import bpy


class OBJECT_OT_scatter_copies(bpy.types.Operator):
    """Duplicate the active object several times along the X axis"""
    bl_idname = "object.scatter_copies"
    bl_label = "Scatter Copies"
    bl_options = {'REGISTER', 'UNDO'}

    count: bpy.props.IntProperty(name="Count", default=3, min=1, max=50)
    spacing: bpy.props.FloatProperty(name="Spacing", default=2.5, subtype='DISTANCE')

    @classmethod
    def poll(cls, context):
        return context.object is not None

    def execute(self, context):
        src = context.object
        for i in range(1, self.count + 1):
            ob = src.copy()
            ob.location.x = src.location.x + self.spacing * i
            context.collection.objects.link(ob)
        self.report({'INFO'}, "Created %d copies" % self.count)
        return {'FINISHED'}


def register():
    bpy.utils.register_class(OBJECT_OT_scatter_copies)


def unregister():
    bpy.utils.unregister_class(OBJECT_OT_scatter_copies)


if __name__ == "__main__":
    register()
    # Now search for "Scatter Copies" with F3, or call it from a script:
    # bpy.ops.object.scatter_copies(count=5)
`,
  },
  {
    name: 'UI Panel',
    file: 'ui_panel.py',
    language: 'python',
    body: `import bpy


class VIEW3D_PT_quick_tools(bpy.types.Panel):
    """A panel in the 3D Viewport sidebar (press N, then open the "Quick" tab)"""
    bl_label = "Quick Tools"
    bl_idname = "VIEW3D_PT_quick_tools"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Quick"

    def draw(self, context):
        layout = self.layout
        ob = context.object
        if ob is None:
            layout.label(text="No active object", icon='INFO')
            return
        layout.label(text="Active: " + ob.name)
        layout.prop(ob, "location")
        layout.prop(ob, "hide_render")
        row = layout.row(align=True)
        row.operator("mesh.primitive_cube_add", text="Add Cube")
        row.operator("object.delete", text="Delete")
        op = layout.operator("object.select_all", text="Select All")
        op.action = 'SELECT'


def register():
    bpy.utils.register_class(VIEW3D_PT_quick_tools)


def unregister():
    bpy.utils.unregister_class(VIEW3D_PT_quick_tools)


if __name__ == "__main__":
    register()
`,
  },
  {
    name: 'Create Objects',
    file: 'create_objects.js',
    language: 'javascript',
    body: `// JavaScript scripts use the same object model as Python: bpy, mathutils, C, D.
// Operator properties are passed as an object; vectors are live (ob.location.x = 1).
const count = 8;
for (let i = 0; i < count; i++) {
  const angle = (i / count) * Math.PI * 2;
  bpy.ops.mesh.primitive_uv_sphere_add({ radius: 0.4, location: [Math.cos(angle) * 3, Math.sin(angle) * 3, 0.4] });
  const ob = C.object;
  ob.name = \`Orbit \${i + 1}\`;
  ob.modifiers.new('Smooth', 'SUBSURF').levels = 1;
}
print(\`Scene now has \${D.objects.length} objects\`);
`,
  },
  {
    name: 'Animate Objects',
    file: 'animate_objects.js',
    language: 'javascript',
    body: `// Key a simple squash-and-stretch bounce on the active object.
const ob = C.object;
if (!ob) throw new Error('Select an object first');
const frames = [1, 12, 24];
const heights = [0, 2, 0];
frames.forEach((frame, k) => {
  ob.location.z = heights[k];
  ob.scale.z = k === 1 ? 1.2 : 0.8;
  ob.keyframe_insert('location', { frame });
  ob.keyframe_insert('scale', { frame });
});
C.scene.frame_set(1);
`,
  },
  {
    name: 'Operator & Panel',
    file: 'operator_panel.js',
    language: 'javascript',
    body: `// Register an operator and a sidebar panel from JavaScript.
class RandomizeHeights extends bpy.types.Operator {
  static bl_idname = 'object.randomize_heights';
  static bl_label = 'Randomize Heights';
  static bl_options = ['REGISTER', 'UNDO'];
  static properties = { amount: bpy.props.FloatProperty({ name: 'Amount', default: 1, min: 0 }) };
  execute(context) {
    for (const ob of context.selected_objects) ob.location.z = Math.random() * this.amount;
    return 'FINISHED';
  }
}

class HeightsPanel extends bpy.types.Panel {
  static bl_label = 'Heights';
  static bl_category = 'Quick';
  draw(context) {
    this.layout.label({ text: \`\${context.selected_objects.length} selected\` });
    this.layout.operator('object.randomize_heights');
  }
}

bpy.utils.register_class(RandomizeHeights);
bpy.utils.register_class(HeightsPanel);
`,
  },
];
