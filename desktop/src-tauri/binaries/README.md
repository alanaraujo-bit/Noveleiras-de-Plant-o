# Binários que viajam no instalador

O aplicativo não depende de nada instalado na máquina: o Node que roda o
agente e o ffmpeg que lê os vídeos vão **dentro** do instalador. São 176 MB
que o Git nunca mais esqueceria, então ficam fora do histórico.

Antes do primeiro `npx tauri build`, recrie esta pasta:

```powershell
# Node — o mesmo que roda o agente em desenvolvimento
copy "C:\Program Files\nodejs\node.exe" node-x86_64-pc-windows-msvc.exe

# ffmpeg — vem do pacote ffmpeg-static, já instalado na raiz do projeto
copy "..\..\..\node_modules\ffmpeg-static\ffmpeg.exe" ffmpeg-x86_64-pc-windows-msvc.exe
```

O sufixo com o alvo é exigência do empacotador do Tauri; no aplicativo
instalado eles aparecem como `node.exe` e `ffmpeg.exe`, ao lado do executável.

## O que foi usado nesta versão

| arquivo | versão | SHA-256 |
| --- | --- | --- |
| node.exe | v24.19.0 | `3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237` |
| ffmpeg.exe | ffmpeg-static 5.3.0 | `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00` |
