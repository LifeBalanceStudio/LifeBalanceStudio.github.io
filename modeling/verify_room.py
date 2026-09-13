"""저장된 Blender 모델과 다시 가져온 GLB의 구조를 자동 확인한다."""

import json
import math
import struct
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent / "output"
issues = []
required = ["바닥", "천장", "천장등_테두리", "천장등_확산판", "벽스위치_커버", "벽스위치_버튼", "통유리_한장", "블라인드_암막천", "블라인드_하단봉", "블라인드_당김줄", "CRT_곡면화면", "NES_상부", "컨트롤러_본체", "출입문_문짝"]
bpy.ops.wm.open_mainfile(filepath=str(ROOT / "room.blend"))
for name in required:
    if name not in bpy.data.objects:
        issues.append("Blender 누락: " + name)

blind = bpy.data.objects["블라인드_조작"]
fabric = bpy.data.objects["블라인드_암막천"]
bar = bpy.data.objects["블라인드_하단봉"]
states = []
for opening in (0.0, 0.5, 1.0):
    blind["개방도"] = opening
    blind.update_tag()
    bpy.context.view_layer.update()
    bpy.context.scene.frame_set(1)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated_fabric = fabric.evaluated_get(depsgraph)
    evaluated_bar = bar.evaluated_get(depsgraph)
    height = evaluated_fabric.dimensions.z
    states.append({"개방도": opening, "천_높이_m": round(height, 5), "천_상단_z": round(evaluated_fabric.location.z + height / 2, 5), "하단봉_z": round(evaluated_bar.location.z, 5)})
if not states[0]["천_높이_m"] > states[1]["천_높이_m"] > states[2]["천_높이_m"]:
    issues.append("블라인드 개방도에 따른 천 높이가 순서대로 변하지 않음")
if any(abs(state["천_상단_z"] - 2.395) > 0.001 for state in states):
    issues.append("블라인드 천의 상단 고정점이 변함")

tv_body = bpy.data.objects["CRT_몸체"]
tv_normal = tv_body.matrix_world.to_3x3() @ Vector((0, -1, 0))
tv_corners = [tv_body.matrix_world @ Vector(corner) for corner in tv_body.bound_box]
tv_right_gap = 1.5 - max(corner.x for corner in tv_corners)
tv_back_gap = 1.8 - max(corner.y for corner in tv_corners)
cabinet_corners = [obj.matrix_world @ Vector(corner) for obj in bpy.data.objects["TV장_가구"].children_recursive if obj.type == "MESH" for corner in obj.bound_box]
cabinet_right_gap = 1.5 - max(corner.x for corner in cabinet_corners)
cabinet_back_gap = 1.8 - max(corner.y for corner in cabinet_corners)
if not (tv_normal.x < -0.2 and tv_normal.y < -0.7):
    issues.append("TV 전면이 방 중앙을 향한 대각선이 아님")
if min(tv_right_gap, tv_back_gap, cabinet_right_gap, cabinet_back_gap) < 0.02:
    issues.append("TV 또는 TV장이 벽에 겹치거나 여유 간격이 부족함")
tv_placement = {"전면_방향": [round(value, 5) for value in tv_normal], "TV_오른쪽벽_간격_m": round(tv_right_gap, 4), "TV_뒷벽_간격_m": round(tv_back_gap, 4), "TV장_오른쪽벽_간격_m": round(cabinet_right_gap, 4), "TV장_뒷벽_간격_m": round(cabinet_back_gap, 4)}
throw = bpy.data.objects["황토색_담요"]
throw_vertices = [throw.matrix_world @ vertex.co for vertex in throw.data.vertices]
throw_bounds = {axis: [round(min(vertex[index] for vertex in throw_vertices), 4), round(max(vertex[index] for vertex in throw_vertices), 4)] for index, axis in enumerate(("x", "y", "z"))}
if throw_bounds["z"][0] < 0.04 or throw_bounds["z"][0] > 0.32:
    issues.append("갈색 천이 바닥에 닿거나 충분히 아래로 늘어지지 않음")
if throw_bounds["x"][1] < -0.36 or throw_bounds["x"][0] < -1.1:
    issues.append("갈색 천이 우측 가장자리 대신 침대 폭 전체에 놓임")

data = (ROOT / "room.glb").read_bytes()
magic, version, file_length = struct.unpack_from("<4sII", data)
if magic != b"glTF" or version != 2 or file_length != len(data):
    issues.append("GLB 머리말 또는 파일 길이 오류")
json_length, chunk_type = struct.unpack_from("<I4s", data, 12)
if chunk_type != b"JSON":
    issues.append("GLB 첫 청크가 JSON이 아님")
document = json.loads(data[20:20 + json_length])
nodes = {node.get("name"): node for node in document.get("nodes", [])}
for name in required:
    if name not in nodes or "mesh" not in nodes[name]:
        issues.append("GLB 메시 누락: " + name)
if any("uri" in image and not image["uri"].startswith("data:") for image in document.get("images", [])):
    issues.append("GLB에 외부 이미지 경로가 남아 있음")

# 가져오기 자체가 정상 동작하는지 확인하고 실제 정점 값을 읽는다.
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT / "room.glb"))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
for name in required:
    obj = bpy.data.objects.get(name)
    if obj is None or obj.type != "MESH":
        issues.append("GLB 재가져오기 누락: " + name)
for obj in meshes:
    if any(not math.isfinite(value) for vertex in obj.data.vertices for value in vertex.co):
        issues.append("유효하지 않은 정점: " + obj.name)
imported_tv = bpy.data.objects.get("CRT_몸체")
if imported_tv is not None:
    imported_normal = imported_tv.matrix_world.to_3x3() @ Vector((0, -1, 0))
    if (imported_normal - tv_normal).length > 0.001:
        issues.append("GLB 재가져오기에서 TV 회전이 보존되지 않음")

result = {
    "통과": not issues,
    "오류": issues,
    "Blender_개방도_확인": states,
    "TV_대각선배치_확인": tv_placement,
    "갈색천_우측늘어짐_범위_m": throw_bounds,
    "GLB_바이트": len(data),
    "GLB_노드": len(document.get("nodes", [])),
    "GLB_메시": len(document.get("meshes", [])),
    "GLB_재가져오기_메시": len(meshes),
    "GLB_재질": len(document.get("materials", [])),
    "GLB_내장이미지": len(document.get("images", [])),
    "검증범위": "파일 재열기, 부품 포함, GLB 재가져오기, 내장 텍스처, 정점 유효성, 모델 편집용 블라인드 변형",
    "미검증": ["웹 런타임", "실제 텍셀 스플래팅", "서울 날씨", "사용자 입력과 이동", "실기기 성능"],
}
(ROOT / "validation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False), flush=True)
if issues:
    raise RuntimeError("모델 검증 실패")
