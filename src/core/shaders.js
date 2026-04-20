// src/core/shaders.js

export const vertexShaderSource = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  
  uniform vec2 u_resolution;
  
  varying vec2 v_texCoord;
  
  void main() {
    // Convert the position from pixels to 0.0 to 1.0
    vec2 zeroToOne = a_position / u_resolution;
    // Convert from 0->1 to 0->2
    vec2 zeroToTwo = zeroToOne * 2.0;
    // Convert from 0->2 to -1->+1 (clip space)
    vec2 clipSpace = zeroToTwo - 1.0;
    
    gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
    
    // Pass the texCoord to the fragment shader
    v_texCoord = a_texCoord;
  }
`;

export const fragmentShaderSource = `
  precision highp float;
  
  // Passed in from the vertex shader
  varying vec2 v_texCoord;
  
  // The texture
  uniform sampler2D u_image;
  
  // The target color to blend
  uniform vec3 u_targetRGB;
  
  // The blending alpha
  uniform float u_alpha;
  
  void main() {
    vec4 color = texture2D(u_image, v_texCoord);
    
    // Convert target RGB to 0-1 scale
    vec3 targetColor = u_targetRGB / 255.0;
    
    // Mix the original texture color with the target color using alpha
    // alpha=0 -> pure photo, alpha=1 -> pure target color
    vec3 blended = mix(color.rgb, targetColor, u_alpha);
    
    gl_FragColor = vec4(blended, color.a);
  }
`;
