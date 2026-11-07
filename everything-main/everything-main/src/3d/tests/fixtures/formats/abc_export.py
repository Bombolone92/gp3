import bpy, sys, os
args = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.open_mainfile(filepath=args[0])
out = args[1]
# static + animated transforms, deformed (skinned) mesh as point cache
bpy.ops.wm.alembic_export(filepath=out, start=1, end=24, export_hair=False, export_particles=False, triangulate=False, uvs=True, normals=True, face_sets=True)
print('DONE')
