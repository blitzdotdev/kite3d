# BMW X5 visual-study asset

Original BMW Car IT G05 / BMW X5 2018 geometry, CC BY 4.0. Source commit: `6261f53b5ac63c6686039d106fbbbfb693339d72` in https://github.com/bmwcarit/digital-car-3d . See LICENSE.txt and provenance.json.

This is an explicitly approximate vehicle substitute: the reference photograph contains a different compact SUV and sedans. No BMW endorsement is implied.

The original closed-car hierarchy and centimetre dimensions are reconstructed from Ramses Composer. Materials have been adapted to portable glTF PBR; the custom source shaders are not executed. The source archive contains only the public model files, assembly document, README and license. No external service is called during regeneration.

Run `python3 build.py`, then `node optimize.mjs` with Python and SciPy to regenerate from the bundled archive. Named parts and their source IDs remain editable. The glTF has external binary buffers. The source archive and builder are authoring inputs, not public demo runtime dependencies.

The optional offline optimization uses the repository meshoptimizer dependency, retains all source triangles and named parts, and strips unused UV/tangent attributes because the adapted vehicle materials have no image maps. Final binary: recorded in the build output.
