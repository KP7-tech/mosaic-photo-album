// src/components/MosaicCanvas.jsx
import React, { useRef, useEffect, useState } from 'react';
import { vertexShaderSource, fragmentShaderSource } from '../core/shaders';

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader generate error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

export default function MosaicCanvas({ pieces, width, height, viewMode, blueprintUrl }) {
  const canvasRef = useRef(null);
  const [imageMap, setImageMap] = useState({});
  const [blueprintImg, setBlueprintImg] = useState(null);
  const textureCacheRef = useRef({});

  useEffect(() => {
    if (blueprintUrl) {
      const img = new Image();
      img.onload = () => setBlueprintImg(img);
      img.src = blueprintUrl;
    }
  }, [blueprintUrl]);

  useEffect(() => {
    let missingImages = false;
    const newMap = { ...imageMap };
    pieces.forEach(p => {
      if(p.state === 'filled' && p.assignedPhotoUrl && !newMap[p.assignedPhotoUrl]) {
        missingImages = true;
        newMap[p.assignedPhotoUrl] = 'loading';
        const img = new Image();
        img.onload = () => {
          setImageMap(prev => ({...prev, [p.assignedPhotoUrl]: img}));
        };
        img.src = p.assignedPhotoUrl;
      }
    });
    if(missingImages) setImageMap(newMap);
  }, [pieces, imageMap]);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext('webgl');
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }
    
    // Setup shaders
    const vertShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = createProgram(gl, vertShader, fragShader);
    
    if(!program) return;

    // Attributes / Uniforms
    const positionLocation = gl.getAttribLocation(program, "a_position");
    const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const targetRgbLocation = gl.getUniformLocation(program, "u_targetRGB");
    const alphaLocation = gl.getUniformLocation(program, "u_alpha");
    
    // Vertices / Texture Coordinates
    const positionBuffer = gl.createBuffer();
    const texCoordBuffer = gl.createBuffer();
    
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    // Two triangles to form a rectangle
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0.0,  0.0,
      1.0,  0.0,
      0.0,  1.0,
      0.0,  1.0,
      1.0,  0.0,
      1.0,  1.0,
    ]), gl.STATIC_DRAW);

    // Setup viewport
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.useProgram(program);
    gl.uniform2f(resolutionLocation, gl.canvas.width, gl.canvas.height);
    
    // Enable blending for transparency if any
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Get or initialize texture cache
    const textureCache = textureCacheRef.current;

    // Render Logic Selection
    if (viewMode === 'blueprint' && blueprintImg) {
      // 1. Setup full rectangle quad
      setRectangle(gl, positionBuffer, 0, 0, width, height);

      // 2. Load/Bind Blueprint Texture
      let bpTexture = textureCache['blueprint'];
      if (!bpTexture) {
        bpTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, bpTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, blueprintImg);
        textureCache['blueprint'] = bpTexture;
      } else {
        gl.bindTexture(gl.TEXTURE_2D, bpTexture);
      }

      // 3. Bind buffers & attributes
      gl.enableVertexAttribArray(positionLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(texCoordLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

      // 4. Uniforms (No color blend for blueprint)
      gl.uniform3f(targetRgbLocation, 0, 0, 0);
      gl.uniform1f(alphaLocation, 0.0);

      // 5. Draw
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else {
      // Render individual pieces
      pieces.forEach(piece => {
        setRectangle(gl, positionBuffer, piece.x, piece.y, piece.w, piece.h);
        
        let textureKey = piece.state === 'missing' ? 'missing' : piece.assignedPhotoUrl || 'missing';
        let texture = textureCache[textureKey];

        if (!texture) {
          texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          
          if (piece.state === 'filled' && piece.assignedPhotoUrl && imageMap[piece.assignedPhotoUrl] instanceof HTMLImageElement) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageMap[piece.assignedPhotoUrl]);
            textureCache[textureKey] = texture;
          } else if (piece.imageElement) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, piece.imageElement);
          } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
            textureCache['missing'] = texture;
          }
        } else {
          gl.bindTexture(gl.TEXTURE_2D, texture);
        }

        gl.enableVertexAttribArray(positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(texCoordLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

        gl.uniform3f(targetRgbLocation, piece.targetRGB[0], piece.targetRGB[1], piece.targetRGB[2]);
        const blendAlpha = piece.state === 'missing' ? 1.0 : 0.0;
        gl.uniform1f(alphaLocation, blendAlpha);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      });
    }

  }, [pieces, width, height, imageMap, viewMode, blueprintImg]);

  return (
    <canvas 
      ref={canvasRef} 
      width={width} 
      height={height} 
      style={{
        borderRadius: '16px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
        width: '100%',
        height: 'auto'
      }}
    />
  );
}

function setRectangle(gl, buffer, x, y, width, height) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const x1 = x;
  const x2 = x + width;
  const y1 = y;
  const y2 = y + height;
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
     x1, y1,
     x2, y1,
     x1, y2,
     x1, y2,
     x2, y1,
     x2, y2,
  ]), gl.STATIC_DRAW);
}
