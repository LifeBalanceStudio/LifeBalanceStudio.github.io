"""수정 전후의 침구만 같은 카메라와 조명으로 자동 렌더한다. 원본 파일은 저장하지 않는다."""

from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "output" / "previews"
OUTPUT.mkdir(parents=True, exist_ok=True)
cases = [
    (ROOT / "revisions" / "bedding-before-2026-09-12" / "room.blend", "bedding-before", (0.65, -1.60, 1.60)),
    (ROOT / "output" / "room.blend", "bedding-after", (0.65, -1.60, 1.60)),
    (ROOT / "output" / "room.blend", "bedding-after-left", (-2.55, -1.45, 1.45)),
]
for source, label, position in cases:
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    bed = bpy.data.objects["침대_가구"]
    visible = {bed, *bed.children_recursive, bpy.data.objects["바닥"]}
    for obj in scene.objects:
        obj.hide_render = obj not in visible
    background = next(node for node in scene.world.node_tree.nodes if node.type == "BACKGROUND")
    background.inputs[0].default_value = (0.16, 0.18, 0.20, 1)
    background.inputs[1].default_value = 0.45
    light_data = bpy.data.lights.new("침구검사_면광원", "AREA")
    light_data.energy = 280
    light_data.shape = "DISK"
    light_data.size = 3.0
    light = bpy.data.objects.new("침구검사_면광원", light_data)
    scene.collection.objects.link(light)
    light.location = (-0.3, -0.5, 3.0)
    light.rotation_euler = (Vector((-0.91, 0.54, 0.4)) - light.location).to_track_quat('-Z', 'Y').to_euler()
    camera_data = bpy.data.cameras.new("침구검사_카메라")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.85
    camera = bpy.data.objects.new("침구검사_카메라", camera_data)
    scene.collection.objects.link(camera)
    camera.location = position
    camera.rotation_euler = (Vector((-0.89, 0.5, 0.49)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 850
    scene.render.resolution_percentage = 100
    scene.view_settings.exposure = 0
    scene.render.filepath = str(OUTPUT / (label + ".png"))
    bpy.ops.render.render(write_still=True)
    print("침구 비교 렌더 완료: " + label, flush=True)
