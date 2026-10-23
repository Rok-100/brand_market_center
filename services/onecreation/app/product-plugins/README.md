# 产品插件包

这个文件夹用于放置产品插件。插件可以新增或覆盖产品配置、产品图路径和提示词策略，不需要改动程序本体。

推荐结构：

```text
product-plugins/
  wis-sample-plugin/
    product-plugin.json
    assets/
      产品图/
        image-01.png
```

`product-plugin.json` 示例：

```json
{
  "pluginId": "wis-sample-plugin",
  "name": "WIS 示例产品插件",
  "version": "1.0.0",
  "products": [
    {
      "id": "wis-sample-product",
      "name": "WIS示例产品",
      "shortName": "示例产品",
      "imageDir": "assets/产品图",
      "defaultScene": "高端浴室梳妆台",
      "defaultPurpose": "高级感",
      "imagePriority": ["正面", "侧面", "质地"],
      "promptStrategy": {
        "visualIdentity": "保持产品包装、颜色、logo和标签区域稳定",
        "benefitCues": "水润、清透、精致护肤感",
        "maskDetail": "质地水润、有光泽、柔和自然",
        "compliance": "避免医美治疗、夸张前后对比和绝对化功效",
        "negativeExtra": "额外文字，logo反向，包装变形",
        "coreScenes": [
          {
            "coreElement": "{scene}正面陈列",
            "sceneDetail": "{scene}中的干净台面，产品正面居中，前景少量水珠柔焦，后景留白。"
          }
        ]
      }
    }
  ]
}
```

在线更新清单中可通过 `productPlugins` 声明插件 ZIP，程序会安装到这个文件夹。
