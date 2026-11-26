/** Focusing from the projected wave-height Hessian, evaluated on submerged geometry.
 * No contour extraction, tiled image, cell grid or surface-white overlay. */
export const CAUSTIC_GLSL=`
float underwaterCaustic(vec3 world,float t){
 if(world.y>-.05)return 0.;
 float depth=clamp(-world.y,.1,4.);
 vec2 p=world.xz+vec2(.23,.36)*depth;
 vec3 h=vec3(0.);
 for(int i=0;i<5;i++){
  float f=float(i),a=.61+sin(f*2.39996+.4)*.78;
  vec2 d=vec2(cos(a),sin(a));float k=1.91*pow(1.53,f);
  float phase=dot(p,d)*k-sqrt(9.8*k)*t*.42+f*1.731;
  float curvature=-.028*pow(.72,f)*k*k*cos(phase);
  h+=vec3(d.x*d.x,d.y*d.y,d.x*d.y)*curvature;
 }
 float throwDistance=depth*.25;
 float determinant=(1.+throwDistance*h.x)*(1.+throwDistance*h.y)-throwDistance*throwDistance*h.z*h.z;
 float focus=max(0.,1./(.40+abs(determinant)*2.5)-.38);
 return min(focus,1.65)*exp(-depth*.12);
}
`;
