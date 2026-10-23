# Optional local diagnostic: requires NumPy and SciPy; not part of city build.
import numpy as np,json
from scipy.optimize import least_squares
# Manual points in the inspected 566x378 reference. First ground point extrapolated
# because the shop's base is cut by the image border. Vertical correction/lens shift
# is allowed: parallel jambs in the photograph cannot be reproduced by tilting upward.
obs=np.array([[39,84],[39,394],[196,111],[196,362],[478,182],[478,304]],float)
points=np.array([[0,4.25,0],[0,.16,0],[4,4.25,0],[4,.16,0],[24,4.25,0],[24,.16,0]],float)
def project(p):
 x,z,yaw,cy,blue,eye,fov=p;c=np.array([x,eye,z]);f=np.array([np.cos(yaw),0,-np.sin(yaw)]);r=np.cross(f,[0,1,0]);u=np.array([0,1,0]);pts=points.copy();pts[2:4,0]=blue;v=pts-c;depth=v@f;scale=189/np.tan(np.radians(fov)/2)
 return np.array([283+scale*(v@r)/depth,cy-scale*(v@u)/depth]).T
fit=least_squares(lambda p:((project(p)-obs)*np.array([[1,1],[.3,.3],[1,1],[1,1],[1,1],[1,1]])).ravel(),[-6,6,.6,250,4,1.7,35],bounds=([-200,1,.05,0,1,.3,5],[20,200,1.56,500,15,4,100]))
x,z,yaw,cy,blue,eye,fov=fit.x;projected=project(fit.x);points[2:4,0]=blue
out={'position':[x,eye,z],'target':[x+20*np.cos(yaw),eye,z-20*np.sin(yaw)],'fov':fov,'principalPointY':cy,'blueWidth':blue,'landmarks':[{'world':a.tolist(),'referencePixel':b.tolist(),'projectedPixel':q.tolist(),'extrapolated':i==1}for i,(a,b,q) in enumerate(zip(points,obs,projected))],'rmsPixel':float(np.sqrt(np.mean((projected-obs)**2)))}
print(json.dumps(out,indent=2));open(__file__.replace('fit-photo-camera.py','photo-camera-fit.json'),'w').write(json.dumps(out,indent=2))
