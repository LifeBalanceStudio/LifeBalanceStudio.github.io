"""천장 중앙의 얇은 사각 전등을 같은 치수로 생성한다."""

import bpy


def add_ceiling_light():
    existing = bpy.data.objects.get("천장등")
    if existing:
        return existing
    group = bpy.data.objects.new("천장등", None)
    bpy.context.scene.collection.objects.link(group)
    group["상호작용"] = "F 또는 Space로 켜기·끄기. 웹에서 초기 소등"
    group["치수"] = "폭 72cm, 깊이 72cm, 두께 약 6.5cm"

    def panel(name, location, dimensions, color, roughness):
        material = bpy.data.materials.new(name + "_재질")
        material.use_nodes = True
        material.diffuse_color = (*color, 1)
        shader = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
        shader.inputs["Base Color"].default_value = (*color, 1)
        shader.inputs["Roughness"].default_value = roughness
        bpy.ops.mesh.primitive_cube_add(size=1, location=location)
        obj = bpy.context.object
        obj.name = name
        obj.dimensions = dimensions
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(material)
        obj.parent = group
        return obj

    panel("천장등_테두리", (0, 0.05, 2.4725), (0.72, 0.72, 0.055), (0.50, 0.51, 0.49), 0.7)
    panel("천장등_확산판", (0, 0.05, 2.441), (0.66, 0.66, 0.012), (0.76, 0.77, 0.72), 0.45)
    data = bpy.data.lights.new("천장등_면광원", "AREA")
    data.shape = "SQUARE"
    data.size = 0.66
    data.color = (1.0, 0.91, 0.77)
    data.energy = 0
    light = bpy.data.objects.new("천장등_면광원_초기소등", data)
    bpy.context.scene.collection.objects.link(light)
    light.location = (0, 0.05, 2.425)
    light.parent = group
    light["웹_조명"] = "브라우저의 면광원으로 켜기·끄기 처리"
    return group
