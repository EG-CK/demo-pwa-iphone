# AI Trainer Local

Backend local en Python para:

- capturar imagenes desde movil como `OK` o `KO`
- guardar dataset en local
- lanzar entrenamiento binario con `PyTorch`
- revisar progreso desde una consola HTML
- predecir `OK/KO` sobre una imagen nueva desde la consola

## Arranque

```powershell
python ai_trainer\server.py
```

URLs:

- Consola: `http://127.0.0.1:8765/console`
- Capturador movil: `http://127.0.0.1:8765/capture`

## Estructura

- `ai_trainer/data/dataset/ok`
- `ai_trainer/data/dataset/ko`
- `ai_trainer/data/models`
- `ai_trainer/data/records.json`

## Notas

- El entrenamiento es una primera version base con clasificacion binaria `OK/KO`.
- Se necesitan al menos 8 imagenes totales y minimo 2 por clase para entrenar.
- El modelo guardado se exporta como `model-latest.pt` y tambien con timestamp.
