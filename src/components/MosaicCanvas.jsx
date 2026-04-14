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

export default function MosaicCanvas({ pieces, width, height }) {
  const canvasRef = useRef(null);
  const [imageMap, setImageMap] = useState({});

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

    // Render individual pieces (Tile-based rendering simple mock)
    pieces.forEach(piece => {
      // 1. Setup Quad Position based on piece.x, piece.y
      setRectangle(gl, positionBuffer, piece.x, piece.y, piece.w, piece.h);
      
      // 2. Setup Texture
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      
      if(piece.state === 'filled' && piece.assignedPhotoUrl && imageMap[piece.assignedPhotoUrl] instanceof HTMLImageElement) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageMap[piece.assignedPhotoUrl]);
      } else if (piece.imageElement) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, piece.imageElement);
      } else {
        // Fallback for missing pieces: white texture, pure target color.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      }

      // 3. Bind buffers & attributes
      gl.enableVertexAttribArray(positionLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      
      gl.enableVertexAttribArray(texCoordLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
      
      // 4. Set Uniforms (Blend Color & Alpha)
      // piece.targetRGB = [r, g, b]
      gl.uniform3f(targetRgbLocation, piece.targetRGB[0], piece.targetRGB[1], piece.targetRGB[2]);
      
      // Alpha depends if it's missing or filled
      // Filled = 0.2 blend. Missing = 0.8 blend or 1.0.
      const blendAlpha = piece.state === 'missing' ? 1.0 : 0.2;
      gl.uniform1f(alphaLocation, blendAlpha);
      
      // 5. Draw the mapped quad
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    });

  }, [pieces, width, height, imageMap]);

  return (
    <canvas 
      ref={canvasRef} 
      width={width} 
      height={height} 
      style={{
        borderRadius: '16px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
        width: '100%',
        maxWidth: `${width}px`,
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
