
let image = undefined;
let canvas = undefined;

var handleRadius = 10

var dragTL = dragBL = dragTR = dragBR = false;
var dragWholeRect = false;

var roiRect = {};
var roiPoints = [];

var current_canvas_rect={}

var mouseX, mouseY
var startX, startY

//drawRectInCanvas() connected functions -- START
function drawCircle(x, y, radius) {
  var ctx = canvas.getContext("2d");
  ctx.fillStyle = "#c757e7";
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fill();
}

function drawHandles() {
  drawCircle(roiRect.left, roiRect.top, handleRadius);
  drawCircle(roiRect.right, roiRect.top, handleRadius);
  drawCircle(roiRect.right, roiRect.bottom, handleRadius);
  drawCircle(roiRect.left, roiRect.bottom, handleRadius);
}


function drawRectInCanvas()
{
  if (roiRect.left < 0) {
    return;
  }
  var ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  ctx.lineWidth = "6";
  ctx.fillStyle = "rgba(199, 87, 231, 0.2)";
  ctx.strokeStyle = "#c757e7";
  ctx.rect(roiRect.left, roiRect.top, roiRect.right - roiRect.left, roiRect.bottom - roiRect.top);
  ctx.fill();
  ctx.stroke();
  drawHandles();

  for (let i = 0; i < roiPoints.length; i++) {
    drawCircle(roiPoints[i].x, roiPoints[i].y, handleRadius/2);
  }
}
//drawRectInCanvas() connected functions -- END

function mouseUp(e) {
  dragTL = dragTR = dragBL = dragBR = false;
  dragWholeRect = false;
  if (roiRect.left && !roiRect.right) {
    roiPoints.push({x: roiRect.left, y: roiRect.top});
    roiRect = {};
  }
}

//mousedown connected functions -- START
function checkInRect(x, y, r) {
  return (x>r.left && x<r.right) && (y>r.top && y<r.bottom);
}

function checkCloseEnough(p1, p2) {
  return Math.abs(p1 - p2) < handleRadius;
}

function getMousePos(canvas, evt) {
  var clx, cly
  if (evt.type == "touchstart" || evt.type == "touchmove") {
    clx = evt.touches[0].clientX;
    cly = evt.touches[0].clientY;
  } else {
    clx = evt.clientX;
    cly = evt.clientY;
  }
  var boundingRect = canvas.getBoundingClientRect();
  return {
    x: (clx - boundingRect.left) * canvas.width / canvas.clientWidth,
    y: (cly - boundingRect.top) * canvas.height / canvas.clientHeight
  };
}

function mouseDown(e) {
  var pos = getMousePos(this,e);
  mouseX = pos.x;
  mouseY = pos.y;

  if (!roiRect.left) {
    roiRect.left = mouseX;
    roiRect.top = mouseY;
  }

  // 0. inside movable rectangle
  if (checkInRect(mouseX, mouseY, roiRect)){
      dragWholeRect=true;
      startX = mouseX;
      startY = mouseY;
  }
  // 1. top left
  else if (checkCloseEnough(mouseX, roiRect.left) && checkCloseEnough(mouseY, roiRect.top)) {
      dragTL = true;
  }
  // 2. top right
  else if (checkCloseEnough(mouseX, roiRect.right) && checkCloseEnough(mouseY, roiRect.top)) {
      dragTR = true;
  }
  // 3. bottom left
  else if (checkCloseEnough(mouseX, roiRect.left) && checkCloseEnough(mouseY, roiRect.bottom)) {
      dragBL = true;
  }
  // 4. bottom right
  else if (checkCloseEnough(mouseX, roiRect.right) && checkCloseEnough(mouseY, roiRect.bottom)) {
      dragBR = true;
  }
  // (5.) none of them
  else {
      // handle not resizing
  }
  drawRectInCanvas();
}
//mousedown connected functions -- END

function mouseMove(e) {
  var pos = getMousePos(this,e);
  mouseX = pos.x;
  mouseY = pos.y;

  if (roiRect.left && !roiRect.right) {
    roiRect.right = mouseX;
    roiRect.bottom = mouseY;
  }

  if (dragWholeRect) {
      e.preventDefault();
      e.stopPropagation();
      dx = mouseX - startX;
      dy = mouseY - startY;
      if ((roiRect.left+dx)>0 && (roiRect.left+dx+roiRect.width)<canvas.width){
        roiRect.left += dx;
      }
      if ((roiRect.top+dy)>0 && (roiRect.top+dy+roiRect.height)<canvas.height){
        roiRect.top += dy;
      }
      startX = mouseX;
      startY = mouseY;
  } else if (dragTL) {
      e.preventDefault();
      e.stopPropagation();
      roiRect.left = mouseX;
      roiRect.top = mouseY;
  } else if (dragTR) {
      e.preventDefault();
      e.stopPropagation();
      roiRect.right = mouseX;
      roiRect.top = mouseY;
  } else if (dragBL) {
      e.preventDefault();
      e.stopPropagation();
      roiRect.left = mouseX;
      roiRect.bottom = mouseY;
  } else if (dragBR) {
      e.preventDefault();
      e.stopPropagation();
      roiRect.right = mouseX;
      roiRect.bottom = mouseY;
  }
  if (roiRect.left > roiRect.right) {
    const x = roiRect.right;
    roiRect.right = roiRect.left;
    roiRect.left = x;
    if (dragTL) {
      dragTL = false;
      dragTR = true;
    } else if (dragTR) {
      dragTL = true;
      dragTR = false;
    } else if (dragBL) {
      dragBL = false;
      dragBR = true;
    } else if (dragBR) {
      dragBL = true;
      dragBR = false;
    }
  }
  if (roiRect.top > roiRect.bottom) {
    const y = roiRect.bottom;
    roiRect.bottom = roiRect.top;
    roiRect.top = y;
    if (dragTL) {
      dragTL = false;
      dragBL = true;
    } else if (dragTR) {
      dragBR = true;
      dragTR = false;
    } else if (dragBL) {
      dragBL = false;
      dragTL = true;
    } else if (dragBR) {
      dragTR = true;
      dragBR = false;
    }
  }
  drawRectInCanvas();
}

function doubleClick() {
  roiRect = {};
  roiPoints = [];
}
function updateCurrentCanvasRect(){
  current_canvas_rect.height = canvas.height
  current_canvas_rect.width = canvas.width
  current_canvas_rect.top = image.offsetTop
  current_canvas_rect.left = image.offsetLeft
}

function repositionCanvas(){
  if (!canvas) {
    return;
  }
  if (roiRect.top < 0) {
    return;
  }
  //compute ratio comparing the NEW canvas rect with the OLD (current)
  var ratio_w = canvas.width / current_canvas_rect.width;
  var ratio_h = canvas.height / current_canvas_rect.height;
  //update rect coordinates
  roiRect.top = roiRect.top * ratio_h;
  roiRect.left = roiRect.left * ratio_w;
  roiRect.height = roiRect.height * ratio_h;
  roiRect.width = roiRect.width * ratio_w;
  updateCurrentCanvasRect();
  drawRectInCanvas();
}
function initForRoi(){
  if (!image) {
    image = document.getElementById('image-preview');
    canvas = document.getElementById('roi-overlay')
    canvas.addEventListener('mousedown', mouseDown, false);
    canvas.addEventListener('mouseup', mouseUp, false);
    canvas.addEventListener('mousemove', mouseMove, false);
    canvas.addEventListener('touchstart', mouseDown);
    canvas.addEventListener('touchmove', mouseMove);
    canvas.addEventListener('touchend', mouseUp);

    canvas.addEventListener('dblclick', doubleClick);
  }
  roiRect = {};
  roiPoints = [];
  updateCurrentCanvasRect();
  drawRectInCanvas();
}

window.addEventListener('resize',repositionCanvas)
