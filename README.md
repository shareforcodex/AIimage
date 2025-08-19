this is image edit webapp built by LLM

the prompt is:
built a webapp for editing image, use html and js , support many common edit function in gimg and PS, make UI looks like PS but more clean and friendly for mobile small screen, support touch devices
 canvas , load image into canvas for editing, user can set canvas size to 1024x1024 or 1024x1536, 1536x1024, and custom size, user can undo and redo last action


- Add crop with draggable marquee.
- Add zoom/pan and pinch gestures.
- Add filters (blur, sharpen) and levels/curves.
- Persist session state to IndexedDB.

implement a way to add multiple images to canvas, user can select each image object in the canvas to edit,pan, resize
give option in menu to keep ratio when resize image, default is enable
when in crop mode , apply crop to put new croped image in to canvas, instead replace whole canvas with croped image

when load new image, always show it in it's original size in canvas, and put the image at current viewport  left top 
add new button in file dropdown , to export the image

when click image to resize, if user use corner point to resize, keep resize and ratio, if it use middle point , then crop the image, just remove the part that out of the boundary

when export the image, it alway export 1024x1536, fix it to canvas size

clear canvas not works, also show current canvas status like size at right botton of window