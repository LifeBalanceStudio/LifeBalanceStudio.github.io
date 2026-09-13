"""문 오른쪽 실내 벽의 천장등 스위치를 생성한다."""

import bpy


def add_wall_switch():
    existing = bpy.data.objects.get("천장등_벽스위치")
    if existing:
        return existing
    group = bpy.data.objects.new("천장등_벽스위치", None)
    bpy.context.scene.collection.objects.link(group)
    group["상호작용"] = "F 또는 Space로 기존 천장등과 같은 상태를 켜기·끄기"
    group["치수"] = "문 오른쪽 벽, 중심 높이 115cm, 커버 9×13cm"
    parts = [
        ("벽스위치_커버", (0.96, -1.691, 1.15), (0.09, 0.018, 0.13), (0.63, 0.60, 0.52)),
        ("벽스위치_버튼", (0.96, -1.677, 1.15), (0.05, 0.008, 0.078), (0.83, 0.80, 0.71)),
    ]
    for name, location, dimensions, color in parts:
        material = bpy.data.materials.new(name + "_재질")
        material.use_nodes = True
        material.diffuse_color = (*color, 1)
        shader = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
        shader.inputs["Base Color"].default_value = (*color, 1)
        shader.inputs["Roughness"].default_value = 0.65
        bpy.ops.mesh.primitive_cube_add(size=1, location=location)
        obj = bpy.context.object
        obj.name = name
        obj.dimensions = dimensions
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(material)
        obj.parent = group
        obj.visible_camera = False
        obj["검토_단면"] = "입구 벽과 함께 Cycles 검토 카메라에서만 숨김; 웹 모델에는 포함"
    return group
