import fragmentSource from '~/assets/shaders/cloud-sea.frag?raw'
import { cloudPaletteKeys, readCloudSeaPalette } from './cloud-sea-palette'

/** Pixel coordinates of the unskewed train bounds relative to the scenery canvas. */
export interface CloudTrainBounds {
  left: number
  bottom: number
  pitch: number
  coaches: number
}

/** One scenery renderer, retained by the default layout across routes. */
export function createCloudSea(canvas: HTMLCanvasElement, trainArt: HTMLImageElement, grain: HTMLImageElement) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' })
  if (!gl)
    return null
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  const trainTexture = gl.createTexture()
  const noiseTexture = gl.createTexture()
  const shaders: WebGLShader[] = []

  function dispose() {
    shaders.forEach(shader => gl!.deleteShader(shader))
    gl!.deleteTexture(noiseTexture)
    gl!.deleteTexture(trainTexture)
    gl!.deleteBuffer(buffer)
    gl!.deleteProgram(program)
    gl!.getExtension('WEBGL_lose_context')?.loseContext()
  }

  try {
    if (!program || !buffer || !trainTexture || !noiseTexture)
      throw new Error('Cloud sea resources unavailable')
    for (const [type, source] of [
      [gl.VERTEX_SHADER, 'attribute vec2 aPosition; void main(){ gl_Position=vec4(aPosition,0.0,1.0); }'],
      [gl.FRAGMENT_SHADER, fragmentSource],
    ] as const) {
      const shader = gl.createShader(type)
      if (!shader)
        throw new Error('Cloud sea shader unavailable')
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) || 'Cloud shader compilation failed')
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) || 'Cloud shader could not link')
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'aPosition')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, trainTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, trainArt)
    gl.uniform1i(gl.getUniformLocation(program, 'uTrainArt'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, noiseTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    // scripts/generate-cloud-grain.py bakes these ranks as data, not display colours.
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, grain)
    gl.uniform1i(gl.getUniformLocation(program, 'uNoise'), 1)
    gl.uniform1f(gl.getUniformLocation(program, 'uNoiseTexel'), 1 / grain.naturalWidth)
    const names = ['uTrainBounds', 'uResolution', 'uTime', 'uZoom', 'uPointer', 'uTravel', 'uDetail', 'uSkyTop', 'uSkyHorizon', 'uLight', 'uShade', 'uDeep', 'uRail']
    const uniforms = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]))
    const paletteUniforms = ['uSkyTop', 'uSkyHorizon', 'uLight', 'uShade', 'uDeep', 'uRail']
    function updatePalette() {
      const palette = readCloudSeaPalette(canvas)
      cloudPaletteKeys.forEach((key, i) => gl!.uniform3fv(uniforms[paletteUniforms[i]!]!, palette[key]))
    }
    updatePalette()

    return {
      updatePalette,
      setLayout(cssWidth: number, cssHeight: number, train: CloudTrainBounds | null) {
        if (!cssWidth || !cssHeight)
          return
        // Give narrow high-DPI screens sharper edges while bounding the cost of a full-screen frame.
        const pixelBudget = 800_000
        const scale = Math.min(window.devicePixelRatio || 1, 1.5, 1440 / cssWidth, Math.sqrt(pixelBudget / (cssWidth * cssHeight)))
        const width = Math.max(1, Math.round(cssWidth * scale))
        const height = Math.max(1, Math.round(cssHeight * scale))
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
          gl.viewport(0, 0, width, height)
        }
        // The horizon uses canvas-height units so one unit has the same scale on both axes.
        if (train) {
          gl.uniform4f(uniforms.uTrainBounds!, (train.left - cssWidth / 2) / cssHeight, 1 - train.bottom / cssHeight, train.pitch / cssHeight, train.coaches)
        }
        else {
          gl.uniform4f(uniforms.uTrainBounds!, 0, 0, 0, 0)
        }
        gl.uniform2f(uniforms.uResolution!, width, height)
        gl.uniform1f(uniforms.uDetail!, cssWidth < 640 ? 7 : 8)
      },
      draw(elapsed: number, zoom: number, pointer: [number, number], travel: number) {
        gl.uniform1f(uniforms.uTime!, elapsed * 0.001)
        gl.uniform1f(uniforms.uZoom!, zoom)
        gl.uniform2f(uniforms.uPointer!, pointer[0], pointer[1])
        gl.uniform1f(uniforms.uTravel!, travel)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      },
      dispose,
    }
  }
  catch (error) {
    if (import.meta.dev)
      console.warn('[cloud-sea]', error)
    dispose()
    return null
  }
}
