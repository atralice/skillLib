import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

if ("undefined" !== typeof Element) {
  if (undefined === Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (undefined === Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (undefined === Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
}
