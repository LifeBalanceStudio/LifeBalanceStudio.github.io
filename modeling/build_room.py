"""Blender 4.5에서 편집 가능한 방 모델과 검토용 산출물을 만든다."""

import json
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "output"
PREVIEWS = OUTPUT / "previews"
TEXTURES = OUTPUT / "textures"
for directory in (OUTPUT, PREVIEWS, TEXTURES):
    directory.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0
scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = 1280
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = -0.7
scene.world = bpy.data.worlds.new("검토용_환경")
scene.world.use_nodes = True
scene.world.node_tree.nodes.clear()
world_background = scene.world.node_tree.nodes.new("ShaderNodeBackground")
world_output = scene.world.node_tree.nodes.new("ShaderNodeOutputWorld")
scene.world.node_tree.links.new(world_background.outputs[0], world_output.inputs[0])
world_background.inputs[0].default_value = (0.13, 0.17, 0.24, 1)
world_background.inputs[1].default_value = 0.16


def group(name):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    return obj


room = group("방_구조")
bed = group("침대_가구")
cabinet = group("TV장_가구")
television = group("CRT_TV")
console = group("NES_게임기")
tv_assembly = group("TV_대각선배치")
TV_OLD_CENTER = Vector((0.96, 1.15, 0))
TV_NEW_CENTER = Vector((0.80, 1.07, 0))
TV_ANGLE = math.radians(-32)
tv_assembly.location = TV_NEW_CENTER
tv_assembly.rotation_euler.z = TV_ANGLE
tv_assembly["배치_기준"] = "시안처럼 오른쪽 벽에서 방 중앙 쪽으로 대각선 배치"
tv_assembly["회전각_도"] = -32.0
for part in (cabinet, television, console):
    part.parent = tv_assembly
    part.location = -TV_OLD_CENTER


def tv_point(point):
    return TV_NEW_CENTER + Matrix.Rotation(TV_ANGLE, 3, "Z") @ (Vector(point) - TV_OLD_CENTER)


controller = group("NES_컨트롤러")
window = group("창문_통유리")
blind = group("블라인드_조작")
props = group("생활_소품")
preview = group("검토용_배경과조명")
blind["개방도"] = 0.88
blind.id_properties_ui("개방도").update(min=0.0, max=1.0, description="0은 닫힘, 1은 열림")
blind["상호작용_대상"] = "블라인드_당김줄"
television["상호작용_진입키"] = "Space 또는 F"
television["화면_대상"] = "CRT_곡면화면"
room["치수_제안"] = "폭 3.0m, 깊이 3.5m, 높이 2.5m; 사용자 검토 전"


def material(name, color, roughness=0.8, texture=None, emission=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    shader = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    output = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(shader.outputs[0], output.inputs[0])
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    if texture:
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = texture
        node.interpolation = "Closest"
        mat.node_tree.links.new(node.outputs["Color"], shader.inputs["Base Color"])
    if emission:
        shader.inputs["Emission Color"].default_value = (*color, 1)
        shader.inputs["Emission Strength"].default_value = emission
    return mat


def texture(name, base, kind, size=256):
    rng = random.Random(name)
    img = bpy.data.images.new(name, width=size, height=size, alpha=False)
    pixels = []
    for y in range(size):
        for x in range(size):
            noise = rng.uniform(-0.02, 0.02)
            if kind == "wood":
                noise += math.sin(x * 0.67 + math.sin(y * 0.085) * 1.5) * 0.055
            elif kind == "cloth":
                noise += (0.035 if (x // 8 + y // 8) % 2 else -0.035)
            elif kind == "rug":
                noise += 0.055 if y % 16 in (0, 1, 6, 7) else -0.015
            pixels.extend([max(0.01, min(1, channel + noise)) for channel in base] + [1])
    img.pixels = pixels
    img.filepath_raw = str(TEXTURES / (name + ".png"))
    img.file_format = "PNG"
    img.save()
    img.pack()
    return img


wood = material("목재_따뜻한갈색", (0.25, 0.13, 0.07), texture=texture("목재", (0.30, 0.16, 0.09), "wood"))
wall_mat = material("벽_회갈색", (0.41, 0.36, 0.31), texture=texture("벽", (0.44, 0.40, 0.35), "wall"))
floor_mat = material("바닥_목재", (0.20, 0.13, 0.08), texture=texture("바닥", (0.25, 0.18, 0.12), "wood"))
bedding = material("이불_청회색", (0.19, 0.23, 0.26), texture=texture("침구", (0.22, 0.26, 0.29), "cloth"))
linen = material("베개_린넨", (0.49, 0.43, 0.34), texture=texture("베개", (0.48, 0.43, 0.35), "cloth"))
throw_mat = material("담요_황토색", (0.43, 0.23, 0.10), texture=texture("담요", (0.44, 0.27, 0.14), "cloth"))
rug_mat = material("러그_회색무늬", (0.21, 0.22, 0.22), texture=texture("러그", (0.24, 0.25, 0.24), "rug"))
charcoal = material("검은플라스틱", (0.022, 0.027, 0.032), 0.48)
tv_plastic = material("CRT_플라스틱", (0.11, 0.13, 0.14), 0.48)
nes_grey = material("NES_밝은회색", (0.56, 0.55, 0.49), 0.48)
nes_dark = material("NES_진회색", (0.22, 0.23, 0.24), 0.62)
red = material("버튼_빨강", (0.50, 0.018, 0.014), 0.43)
rope_mat = material("당김줄_회베이지", (0.67, 0.63, 0.51), 0.7)
blind_mat = material("암막천_불투명", (0.043, 0.047, 0.05), texture=texture("암막천", (0.075, 0.078, 0.082), "cloth"))
lamp_mat = material("스탠드갓_소등", (0.43, 0.37, 0.28))


def finish(obj, name, mat=None, parent=None):
    obj.name = name
    if mat:
        obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return obj


def box(name, location, dimensions, mat, parent=None, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("모서리_다듬기", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(obj, name, mat, parent)


def cylinder(name, location, radius, depth, mat, parent=None, rotation=(0, 0, 0), vertices=20):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    return finish(bpy.context.object, name, mat, parent)


def curve(name, points, radius, mat, parent=None, cyclic=False):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.bevel_depth = radius
    data.bevel_resolution = 1
    spline = data.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for dst, point in zip(spline.points, points):
        dst.co = (*point, 1)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    return finish(obj, name, mat, parent)


# 입구 벽은 모델에 포함하고 검토 카메라에서만 단면으로 보이게 한다.
box("바닥", (0, 0.05, -0.065), (3.16, 3.66, 0.13), floor_mat, room)
box("왼쪽벽", (-1.58, 0.05, 1.25), (0.16, 3.66, 2.5), wall_mat, room)
box("오른쪽벽", (1.58, 0.05, 1.25), (0.16, 3.66, 2.5), wall_mat, room)
box("천장", (0, 0.05, 2.58), (3.16, 3.66, 0.16), wall_mat, room)
sys.path.insert(0, str(ROOT))
from ceiling_light_model import add_ceiling_light
add_ceiling_light()
from wall_switch_model import add_wall_switch
add_wall_switch()
for x in (-1.45, 1.45):
    box("뒷벽_기둥", (x, 1.88, 1.25), (0.10, 0.16, 2.5), wall_mat, room)
box("뒷벽_창아래", (0, 1.88, 0.5), (2.8, 0.16, 1.0), wall_mat, room)
box("뒷벽_창위", (0, 1.88, 2.46), (2.8, 0.16, 0.08), wall_mat, room)
front_parts = [
    box("입구벽_왼쪽", (-0.95, -1.78, 1.25), (1.1, 0.16, 2.5), wall_mat, room),
    box("입구벽_오른쪽", (1.1, -1.78, 1.25), (0.8, 0.16, 2.5), wall_mat, room),
    box("입구벽_문위", (0.15, -1.78, 2.34), (1.1, 0.16, 0.32), wall_mat, room),
]
for x in (-0.405, 0.705):
    front_parts.append(box("출입문_문틀", (x, -1.675, 1.08), (0.055, 0.09, 2.16), wood, room))
front_parts.append(box("출입문_상단틀", (0.15, -1.675, 2.17), (1.16, 0.09, 0.055), wood, room))
door_pivot = group("출입문_경첩")
door_pivot.parent = room
door_pivot.location = (-0.37, -1.67, 0)
door_leaf = box("출입문_문짝", (0.52, 0, 1.055), (1.04, 0.055, 2.11), wood, door_pivot, 0.008)
door_handle = box("출입문_손잡이", (0.92, 0.07, 1.02), (0.14, 0.10, 0.025), nes_dark, door_pivot, 0.008)
door_pivot.rotation_euler.z = math.radians(78)
front_parts.extend((door_leaf, door_handle))
for obj in front_parts:
    obj.visible_camera = False
    obj["검토_단면"] = "Cycles 검토 카메라에서만 가림 해제; 실제 모델에는 포함"
for x in (-1.49, 1.49):
    box("걸레받이", (x, 0.05, 0.07), (0.025, 3.5, 0.14), wood, room)
box("걸레받이_뒤", (0, 1.78, 0.07), (3, 0.035, 0.14), wood, room)
for y in [i * 0.175 - 1.7 for i in range(21)]:
    box("바닥_판재이음", (0, y, 0.001), (3, 0.004, 0.002), charcoal, room)

# 침대와 고정된 직물 형태.
box("침대_프레임", (-0.91, 0.54, 0.27), (1.07, 2.16, 0.27), wood, bed, 0.012)
for x in (-1.36, -0.46):
    for y in (-0.43, 1.51):
        box("침대_다리", (x, y, 0.14), (0.085, 0.085, 0.28), wood, bed, 0.008)
box("침대_머리판", (-0.91, 1.64, 0.74), (1.14, 0.085, 0.86), wood, bed, 0.017)
box("매트리스", (-0.91, 0.54, 0.47), (1.015, 2.02, 0.18), linen, bed, 0.07)
box("베개", (-0.91, 1.28, 0.625), (0.77, 0.37, 0.17), linen, bed, 0.075)


def cloth(name, center_x, y0, y1, half_width, top, mat, phase, hang_right=False):
    nx, ny = 30, 40
    verts, faces = [], []
    for j in range(ny + 1):
        t = j / ny
        y = y0 + (y1 - y0) * t
        for i in range(nx + 1):
            u = i / nx
            if hang_right:
                # 오른쪽 발치로 비스듬히 걸친 천의 끝을 침대 옆으로 늘어뜨린다.
                raw_x = center_x - 0.11 + u * (0.95 + 0.025 * math.sin(t * 5.7))
                edge_x = center_x + 0.47
                overhang = max(0, raw_x - edge_x)
                wrap = 1 - math.exp(-overhang / 0.055)
                x = min(raw_x, edge_x) + 0.115 * (1 - (1 - wrap) ** 2)
                x += 0.011 * wrap * math.sin(t * 13 + u * 4)
                y = y1 + (y0 - y1) * u + (2 * t - 1) * half_width
                y += 0.02 * math.sin(u * 8 + t * 3)
                support_x = min(raw_x, edge_x)
                bed_u = ((support_x - center_x) / 0.565 + 1) / 2
                bed_t = (y + 0.57) / 1.70
                support_z = 0.595 - max(0, abs(support_x - center_x) - 0.43) * 1.5
                support_z -= max(0, 0.11 - bed_t) * 1.15
                support_z += 0.009 * math.sin(bed_u * 14 + bed_t * 5) + 0.006 * math.sin(bed_u * 8 - bed_t * 17)
                z = support_z + 0.022 - 0.075 * wrap - 0.75 * overhang
                z += (0.005 + 0.012 * wrap) * math.sin(t * 15 + u * 5 + phase)
                verts.append((x, y, z))
            else:
                x = (u * 2 - 1) * half_width
                edge = max(0, abs(x) - 0.43)
                front = max(0, 0.11 - t)
                z = top - edge * 1.5 - front * 1.15
                z += 0.009 * math.sin(u * 14 + t * 5 + phase) + 0.006 * math.sin(u * 8 - t * 17)
                # 처지는 높이는 유지하되 매트리스 바깥을 먼저 감싸도록 가장자리를 펼친다.
                if edge:
                    side_t = edge / (half_width - 0.43)
                    x = math.copysign(0.43 + (half_width - 0.43) * (1 - (1 - side_t) ** 4), x)
                wrapped_y = y
                if front:
                    fold_y = y0 + (y1 - y0) * 0.11
                    wrapped_y = fold_y - (fold_y - y0) * (1 - (1 - front / 0.11) ** 4)
                verts.append((center_x + x, wrapped_y, z))
    for j in range(ny):
        for i in range(nx):
            k = j * (nx + 1) + i
            faces.append((k, k + 1, k + nx + 2, k + nx + 1))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new()
    for poly in mesh.polygons:
        poly.use_smooth = True
        for loop_index in poly.loop_indices:
            vertex = mesh.loops[loop_index].vertex_index
            uv.data[loop_index].uv = ((vertex % (nx + 1)) / nx, (vertex // (nx + 1)) / ny)
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    finish(obj, name, mat, bed)
    solid = obj.modifiers.new("천_두께", "SOLIDIFY")
    solid.thickness = 0.012
    # 갈색 천의 두께는 받침 이불과 반대쪽으로 두어 안쪽 면이 다시 파고들지 않게 한다.
    solid.offset = 1.0 if hang_right else -1.0
    return obj


duvet = cloth("이불_고정주름", -0.91, -0.57, 1.13, 0.565, 0.595, bedding, 0)
throw_cloth = cloth("황토색_담요", -0.91, -0.33, 0.15, 0.23, 0.627, throw_mat, 2, hang_right=True)
# 갈색 천의 대각선 위치와 늘어진 끝은 유지하고, 회색 이불에 닿는 부분만 위로 받친다.
bpy.context.view_layer.update()
duvet_surface = duvet.evaluated_get(bpy.context.evaluated_depsgraph_get())
for vertex in throw_cloth.data.vertices:
    hit, position, _, _ = duvet_surface.ray_cast(Vector((vertex.co.x, vertex.co.y, 2)), Vector((0, 0, -1)), distance=3)
    if hit:
        # 발치 우측은 정점 사이의 평면이 곡면을 가로지르지 않도록 여유를 조금 더 둔다.
        corner = min(1, max(0, (vertex.co.x + 0.43) / 0.085)) * min(1, max(0, (-vertex.co.y - 0.30) / 0.12))
        vertex.co.z = max(vertex.co.z, position.z + 0.026 + 0.016 * corner)
throw_cloth.data.update()
box("통로_러그", (0.0, -0.10, 0.01), (0.66, 2.7, 0.015), rug_mat, props, 0.008)

# TV장은 열려 있는 선반 구조다.
for z in (0.075, 0.52):
    box("TV장_선반", (0.96, 1.15, z), (1.04, 0.69, 0.055), wood, cabinet, 0.008)
for x in (0.455, 1.465):
    box("TV장_옆판", (x, 1.15, 0.30), (0.045, 0.68, 0.46), wood, cabinet)
box("TV장_뒷판", (0.96, 1.47, 0.30), (1.01, 0.03, 0.46), wood, cabinet)
box("TV장_칸막이", (1.18, 1.15, 0.30), (0.04, 0.68, 0.46), wood, cabinet)
for i, color in enumerate(((0.19, 0.22, 0.24), (0.36, 0.18, 0.11), (0.38, 0.37, 0.30), (0.10, 0.16, 0.18))):
    mat = material("카트리지_%d" % i, color)
    box("보관_카트리지", (1.245 + i * 0.052, 1.06, 0.25), (0.04, 0.22, 0.29), mat, cabinet, 0.003)

# CRT의 화면은 교체할 수 있는 별도의 곡면과 재질이다.
box("CRT_몸체", (0.965, 1.15, 0.91), (0.79, 0.60, 0.69), tv_plastic, television, 0.055)
box("CRT_전면테두리", (0.965, 0.835, 0.93), (0.73, 0.058, 0.59), charcoal, television, 0.045)
for x in (0.70, 1.23):
    box("CRT_받침", (x, 1.10, 0.564), (0.16, 0.37, 0.033), charcoal, television, 0.01)
for i in range(8):
    box("CRT_측면통풍구", (1.365, 1.10 + i * 0.039, 0.90), (0.003, 0.019, 0.30), charcoal, television)
for i in range(4):
    box("CRT_전면버튼", (1.13 + i * 0.035, 0.808, 0.62), (0.024, 0.014, 0.018), nes_dark, television, 0.003)
screen_image = bpy.data.images.new("CRT_임시대기화면", width=160, height=120, alpha=False)
pixels = []
for y in range(120):
    for x in range(160):
        shade = (0.72 if y % 3 == 0 else 1.0) * (0.84 + 0.16 * math.cos((x - 80) / 80 * 1.1))
        pixels.extend([0.018 * shade, 0.23 * shade, 0.50 * shade, 1])
screen_image.pixels = pixels
screen_image.filepath_raw = str(TEXTURES / "CRT_임시대기화면.png")
screen_image.file_format = "PNG"
screen_image.save()
screen_image.pack()
screen_mat = material("CRT_화면_교체용", (0.02, 0.23, 0.5), roughness=0.22, emission=3.0)
screen_shader = next(node for node in screen_mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
screen_node = screen_mat.node_tree.nodes.new("ShaderNodeTexImage")
screen_node.image = screen_image
screen_node.interpolation = "Closest"
for socket in ("Base Color", "Emission Color"):
    screen_mat.node_tree.links.new(screen_node.outputs["Color"], screen_shader.inputs[socket])
screen_emission = screen_mat.node_tree.nodes.new("ShaderNodeEmission")
screen_emission.inputs["Strength"].default_value = 2.5
screen_mat.node_tree.links.new(screen_node.outputs["Color"], screen_emission.inputs["Color"])
screen_output = next(node for node in screen_mat.node_tree.nodes if node.type == "OUTPUT_MATERIAL")
screen_mat.node_tree.links.new(screen_emission.outputs[0], screen_output.inputs[0])
verts, faces = [], []
nx, nz = 24, 18
for j in range(nz + 1):
    v = j / nz * 2 - 1
    for i in range(nx + 1):
        u = i / nx * 2 - 1
        corner = max(1, (abs(u) ** 8 + abs(v) ** 8) ** 0.125)
        verts.append((0.965 + u * 0.305 / corner, 0.797 - 0.026 * (1 - u * u) * (1 - v * v), 0.94 + v * 0.225 / corner))
for j in range(nz):
    for i in range(nx):
        k = j * (nx + 1) + i
        faces.append((k, k + 1, k + nx + 2, k + nx + 1))
mesh = bpy.data.meshes.new("CRT_화면메시")
mesh.from_pydata(verts, [], faces)
mesh.update()
uv = mesh.uv_layers.new()
for poly in mesh.polygons:
    for loop_index in poly.loop_indices:
        k = mesh.loops[loop_index].vertex_index
        uv.data[loop_index].uv = ((k % (nx + 1)) / nx, (k // (nx + 1)) / nz)
screen = bpy.data.objects.new("CRT_곡면화면", mesh)
scene.collection.objects.link(screen)
finish(screen, screen.name, screen_mat, television)

# NES와 컨트롤러는 가까이서 형태를 읽을 수 있도록 버튼을 별도 제작한다.
box("NES_하부", (0.82, 1.02, 0.153), (0.40, 0.28, 0.082), nes_dark, console, 0.008)
for x in (0.68, 0.96):
    for y in (0.93, 1.12):
        cylinder("NES_고무받침", (x, y, 0.109), 0.012, 0.012, charcoal, console, vertices=12)
box("NES_상부", (0.82, 1.02, 0.214), (0.405, 0.285, 0.058), nes_grey, console, 0.006)
box("NES_검은띠", (0.94, 0.872, 0.188), (0.064, 0.013, 0.115), charcoal, console)
box("NES_삽입덮개", (0.773, 0.872, 0.215), (0.252, 0.015, 0.04), nes_grey, console, 0.004)
for i in range(2):
    box("NES_전원버튼", (0.68 + i * 0.033, 0.871, 0.15), (0.024, 0.012, 0.017), red, console, 0.002)
for i in range(7):
    box("NES_상단통풍구", (0.95, 0.92 + i * 0.025, 0.246), (0.07, 0.008, 0.003), charcoal, console)
box("컨트롤러_본체", (0.65, 0.08, 0.038), (0.23, 0.103, 0.034), nes_grey, controller, 0.009)
box("컨트롤러_전면", (0.65, 0.08, 0.058), (0.21, 0.084, 0.009), charcoal, controller, 0.004)
for dimensions in ((0.046, 0.015, 0.008), (0.015, 0.045, 0.008)):
    box("십자버튼", (0.582, 0.081, 0.068), dimensions, nes_dark, controller, 0.002)
for x in (0.713, 0.741):
    cylinder("동작버튼", (x, 0.078, 0.068), 0.009, 0.008, red, controller, vertices=16)
for x in (0.644, 0.67):
    box("시작선택버튼", (x, 0.064, 0.068), (0.015, 0.005, 0.004), nes_grey, controller)
controller.location.z = -0.02
curve("컨트롤러_연결선", [(0.65, 0.13, 0.04), (0.66, 0.27, 0.013), (0.53, 0.37, 0.013), (0.72, 0.50, 0.014), (0.66, 0.70, 0.022), tuple(tv_point((0.84, 0.862, 0.15)))], 0.0035, charcoal, props)
curve("NES_TV_AV연결선", [(0.87, 1.16, 0.19), (0.90, 1.42, 0.22), (1.27, 1.51, 0.30), (1.38, 1.53, 0.70), (1.20, 1.46, 0.90)], 0.004, charcoal, console)

# 큰 창문은 중간 분할 없는 하나의 유리다.
for x in (-1.40, 1.40):
    box("창틀_세로", (x, 1.805, 1.72), (0.065, 0.095, 1.52), wood, window, 0.006)
for z in (0.99, 2.43):
    box("창틀_가로", (0, 1.805, z), (2.87, 0.095, 0.065), wood, window, 0.006)
box("창턱", (0, 1.74, 0.965), (2.93, 0.22, 0.045), wood, window, 0.01)
glass_mat = material("통유리_투명", (0.92, 0.97, 1.0), 0.03)
glass_shader = next(node for node in glass_mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
glass_shader.inputs["Transmission Weight"].default_value = 1.0
glass_shader.inputs["IOR"].default_value = 1.45
glass = box("통유리_한장", (0, 1.835, 1.71), (2.74, 0.006, 1.37), glass_mat, window)
glass.visible_shadow = False

# 개방도 속성 하나로 천과 하단 봉을 편집할 수 있게 한다.
BLIND_TOP = 2.395
BLIND_HEIGHT = 1.445
cylinder("블라인드_상단롤", (0, 1.70, 2.435), 0.045, 2.90, nes_dark, blind, (0, math.pi / 2, 0))
fabric = box("블라인드_암막천", (0, 1.70, 1.7), (2.82, 0.025, 1.0), blind_mat, blind)
bar = cylinder("블라인드_하단봉", (0, 1.70, 1.7), 0.012, 2.84, nes_dark, blind, (0, math.pi / 2, 0))


def opening_driver(obj, data_path, axis, expression):
    driver = obj.driver_add(data_path, axis).driver
    variable = driver.variables.new()
    variable.name = "opening"
    variable.targets[0].id = blind
    variable.targets[0].data_path = '["개방도"]'
    driver.expression = expression


opening_driver(fabric, "scale", 2, "max(0.025, 1.445*(1-opening))")
opening_driver(fabric, "location", 2, "2.395-max(0.025, 1.445*(1-opening))/2")
opening_driver(bar, "location", 2, "2.395-max(0.025, 1.445*(1-opening))")
chain_points = []
for i in range(25):
    chain_points.append((-1.45, 1.69, 2.40 - i * 1.10 / 24))
for i in range(13):
    angle = math.pi + i * math.pi / 12
    chain_points.append((-1.428 + math.cos(angle) * 0.022, 1.69, 1.30 + math.sin(angle) * 0.022))
for i in range(25):
    chain_points.append((-1.406, 1.69, 1.30 + i * 1.10 / 24))
pull = curve("블라인드_당김줄", chain_points, 0.004, rope_mat, blind, cyclic=True)
pull["상호작용"] = "블라인드 개방도 조절 대상; 실제 입력은 웹 구현에서 연결"
cylinder("블라인드_줄손잡이", (-1.428, 1.69, 1.285), 0.014, 0.075, rope_mat, blind)

# 꺼진 스탠드와 작은 협탁.
box("협탁_상판", (-1.09, -0.91, 0.43), (0.56, 0.44, 0.055), wood, props, 0.01)
for x in (-1.32, -0.86):
    for y in (-1.08, -0.74):
        box("협탁_다리", (x, y, 0.215), (0.065, 0.065, 0.43), wood, props, 0.004)
box("협탁_아래선반", (-1.09, -0.91, 0.12), (0.50, 0.40, 0.035), wood, props)
cylinder("스탠드_받침", (-1.21, -0.93, 0.473), 0.087, 0.025, charcoal, props)
cylinder("스탠드_기둥", (-1.21, -0.93, 0.60), 0.012, 0.24, charcoal, props)
bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.115, radius2=0.092, depth=0.21, location=(-1.21, -0.93, 0.79))
finish(bpy.context.object, "스탠드_갓_항상소등", lamp_mat, props)
for i in range(3):
    box("협탁_책", (-0.99, -0.89, 0.465 + i * 0.018), (0.18, 0.23, 0.015), linen if i % 2 else wood, props, 0.002)

# 시안의 벽 사진과 옷을 단순한 입체 소품으로 옮긴다.
poster_blue = material("사진_남청색", (0.08, 0.14, 0.20))
poster_mountain = material("사진_산그림자", (0.16, 0.23, 0.26))
poster_snow = material("사진_밝은능선", (0.49, 0.55, 0.53))


def wall_picture(name, y, z, width, height):
    box(name + "_종이", (-1.482, y, z), (0.008, width, height), linen, props)
    box(name + "_바탕", (-1.474, y, z), (0.005, width * 0.91, height * 0.92), poster_blue, props)
    for offset, rise in ((-0.23, 0.23), (0.10, 0.34), (0.30, 0.17)):
        middle = y + width * offset
        low = z - height * 0.42
        peak = z + height * rise
        vertices = [(-1.468, middle - width * 0.27, low), (-1.468, middle + width * 0.28, low), (-1.468, middle, peak)]
        data = bpy.data.meshes.new(name + "_산")
        data.from_pydata(vertices, [], [(0, 1, 2)])
        obj = bpy.data.objects.new(name + "_산", data)
        scene.collection.objects.link(obj)
        finish(obj, obj.name, poster_mountain, props)
        cap = bpy.data.meshes.new(name + "_능선")
        cap.from_pydata([(-1.465, middle - width * 0.09, peak - height * 0.18), (-1.465, middle + width * 0.09, peak - height * 0.18), (-1.465, middle, peak)], [], [(0, 1, 2)])
        obj = bpy.data.objects.new(name + "_능선", cap)
        scene.collection.objects.link(obj)
        finish(obj, obj.name, poster_snow, props)


wall_picture("벽사진_풍경", 0.75, 1.65, 0.38, 0.51)
wall_picture("벽사진_작은사진", 0.61, 1.24, 0.18, 0.18)
coat_mat = material("걸린옷_청회색", (0.055, 0.078, 0.092), texture=texture("걸린옷", (0.12, 0.15, 0.17), "cloth"))
coat_outline = [(-0.10, 0.30), (0.10, 0.30), (0.26, 0.20), (0.30, -0.04), (0.20, -0.09), (0.16, 0.05), (0.15, -0.40), (-0.15, -0.40), (-0.16, 0.05), (-0.20, -0.09), (-0.30, -0.04), (-0.26, 0.20)]
vertices = [(x, -0.24 + y, 1.62 + z) for x in (1.43, 1.48) for y, z in coat_outline]
n = len(coat_outline)
faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, n * 2))]
faces.extend((i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n))
coat_mesh = bpy.data.meshes.new("걸린옷_메시")
coat_mesh.from_pydata(vertices, [], faces)
coat_obj = bpy.data.objects.new("벽에_걸린옷", coat_mesh)
scene.collection.objects.link(coat_obj)
finish(coat_obj, coat_obj.name, coat_mat, props)
box("옷걸이_받침", (1.47, -0.24, 1.985), (0.035, 0.19, 0.045), wood, props, 0.006)
curve("옷걸이_고리", [(1.46, -0.24, 1.985), (1.40, -0.24, 2.0), (1.395, -0.24, 1.94)], 0.006, nes_dark, props)
box("휴지통_바닥", (1.36, 0.52, 0.025), (0.19, 0.23, 0.04), nes_dark, props)
for x in (1.27, 1.45):
    box("휴지통_측면", (x, 0.52, 0.17), (0.018, 0.23, 0.30), nes_dark, props, 0.005)
for y in (0.413, 0.627):
    box("휴지통_전후면", (1.36, y, 0.17), (0.19, 0.018, 0.30), nes_dark, props, 0.005)


def light(name, kind, location, energy, color, target=None, size=1.0):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    data.color = color
    if kind == "AREA":
        data.shape = "RECTANGLE"
        data.size = size
        data.size_y = size * 0.6
        data.specular_factor = 0.0
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = location
    if target is not None:
        obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    obj.parent = preview
    return obj


sun = light("낮_태양", "SUN", (2, 4, 6), 2.2, (1.0, 0.80, 0.57), (-1, -0.8, 0))
sun.data.angle = 0.18
day_fill = light("창밖_확산광", "AREA", (0, 2.02, 2.05), 90, (0.80, 0.85, 1.0), (0, 0, 0.65), 2.6)
tv_fill = light("CRT_표시광", "AREA", tv_point((0.96, 0.740, 0.95)), 35.0, (0.32, 0.56, 1.0), tv_point((0.0, -0.30, 0.65)), 0.56)
detail_fill = light("검토용_상세조명", "AREA", (0.10, -0.45, 1.55), 0, (1, 0.92, 0.82), (0.96, 1.0, 0.63), 1.1)
for lamp in (day_fill, tv_fill):
    lamp.visible_camera = False
    lamp.visible_glossy = False
    lamp.visible_transmission = False
sky_mat = material("창밖_검토용하늘", (0.24, 0.43, 0.68), emission=0.6)
sky = box("창밖_하늘_교체용", (0, 4.2, 2.5), (12, 0.02, 8), sky_mat, preview)
sky.visible_shadow = False


def camera(name, location, target, lens):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.clip_start = 0.04
    data.clip_end = 100
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


entry_camera = camera("카메라_방전체", (0.10, -2.85, 1.50), (0.0, 0.70, 1.03), 25)
top_camera = camera("카메라_배치검토", (0, 0.05, 5.3), (0, 0.05, 0), 36)
top_camera.data.type = "ORTHO"
top_camera.data.ortho_scale = 4.15
tv_camera = camera("카메라_TV접근", (0.15, -1.0, 1.08), tv_point((0.965, 1.10, 0.68)), 34)
scene.camera = entry_camera


def set_state(night=False, closed=False):
    blind["개방도"] = 0.0 if closed else 0.88
    blind.update_tag()
    sun.data.energy = 0 if night else 2.2
    day_fill.data.energy = 0 if night else 90
    world_background.inputs[1].default_value = 0.045 if night else 0.16
    scene.view_settings.exposure = 1.0 if night or closed else -0.25
    shader = next(node for node in sky_mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    color = (0.008, 0.018, 0.048, 1) if night else (0.24, 0.43, 0.68, 1)
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Emission Color"].default_value = color
    shader.inputs["Emission Strength"].default_value = 0.15 if night else 0.6
    bpy.context.view_layer.update()
    scene.frame_set(1)


def export_and_report():
    set_state()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in scene.objects:
        if obj.parent != preview and obj != preview:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT / "room.glb"), export_format="GLB", use_selection=True, export_animations=False, export_extras=True, export_cameras=True, export_lights=False)
    bpy.ops.object.select_all(action="DESELECT")
    blind.select_set(True)
    bpy.context.view_layer.objects.active = blind
    scene.camera = entry_camera
    for area in bpy.context.screen.areas if bpy.context.screen else []:
        if area.type == "VIEW_3D":
            area.spaces.active.region_3d.view_perspective = "CAMERA"
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / "room.blend"))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    triangles = 0
    meshes = 0
    for obj in scene.objects:
        if obj.type in {"MESH", "CURVE"} and obj.parent != preview:
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            mesh.calc_loop_triangles()
            triangles += len(mesh.loop_triangles)
            meshes += 1
            evaluated.to_mesh_clear()
    report = {
        "Blender": bpy.app.version_string,
        "상태": "첫 모델, 사용자 비율 검토 전, 실제 텍셀 스플래팅 미적용",
        "모델_물체수": meshes,
        "삼각형수": triangles,
        "방_치수_m": [3.0, 3.5, 2.5],
        "창문_개구부_m": [2.8, 1.4],
        "블라인드": {"조작객체": blind.name, "속성": "개방도", "열림": 1, "닫힘": 0, "천": fabric.name, "하단봉": bar.name, "줄": pull.name},
        "TV_화면": screen.name,
        "TV_배치": {"중심_m": list(TV_NEW_CENTER), "수직축_회전각_도": -32.0, "기준": "오른쪽 벽에서 방 중앙을 향한 대각선"},
        "파일": ["room.blend", "room.glb"],
        "주의": ["입구 벽과 문은 포함하되 전체 검토 렌더에서 카메라 가림만 해제", "GLB에는 검토용 외부 하늘과 조명 제외", "블라인드 드라이버는 Blender용이며 웹 입력은 별도 구현", "서울 날씨 미연동"],
    }
    (OUTPUT / "model_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("모델 저장 완료: " + json.dumps(report, ensure_ascii=False), flush=True)


export_and_report()
if "--no-render" not in sys.argv:
    for filename, night, closed in (("day-open.png", False, False), ("night-open.png", True, False), ("day-closed.png", False, True)):
        set_state(night, closed)
        scene.render.filepath = str(PREVIEWS / filename)
        bpy.ops.render.render(write_still=True)
        print("렌더 저장 완료: " + filename, flush=True)
    set_state()
    scene.camera = tv_camera
    detail_fill.data.energy = 45
    scene.render.filepath = str(PREVIEWS / "tv-detail.png")
    bpy.ops.render.render(write_still=True)
    detail_fill.data.energy = 0
    scene.camera = top_camera
    ceiling = bpy.data.objects.get("천장")
    ceiling.hide_render = True
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 1100
    scene.render.filepath = str(PREVIEWS / "layout.png")
    bpy.ops.render.render(write_still=True)
    ceiling.hide_render = False
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 800
    scene.camera = entry_camera
    set_state()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / "room.blend"))
