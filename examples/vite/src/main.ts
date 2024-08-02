import "eyepop";
import "eyepop-render-2d";

import { pino } from "pino";
import image1Src from "example.jpg";

import { BoxType } from "../../../src/eyepop-render-2d/render-box";
import { Style } from "../../../src/eyepop-render-2d/style";

const logger = pino({ level: "info", name: "eyepop-example" });

const testParent = document.getElementById("testParent");

async function run(testData: any) {
  // takes the test data, creates a canvas per image, draws the image to the canvas, and then draws the render tests to the canvas
  const endpoint = await EyePop.workerEndpoint({
    auth: {
      oAuth2: true,
    },
    popId: "",
    logger: logger,
  })
    .onStateChanged((fromState: any, toState: any) => {
      logger.info("Endpoint changed state %s -> %s", fromState, toState);
    })
    .connect();

  for (let i = 0; i < testData.length; i++) {
    const canvas = document.createElement(`canvas`) as HTMLCanvasElement;
    canvas.id = `canvas${i + 1}`;
    canvas.classList.add("w-3/12", "h-2/12", "max-h-2/12", "object-contain", "border", "border-black");

    testParent?.appendChild(canvas);

    const context = canvas.getContext("2d");

    const imageBlob = await fetch(testData[i].image).then((res) => res.blob());

    try {
      let results = null;
      results = await endpoint.process({ file: imageBlob });

      for await (let result of await results) {
        canvas.width = result.source_width;
        canvas.height = result.source_height;
        console.log(result);
        let hasText = false;
        for (let j = 0; j < result?.objects?.length; j++) {
          let obj = result.objects[j];
          if (obj.category === "text") {
            hasText = true;
            break;
          }
        }

        const imageObjectURL = URL.createObjectURL(imageBlob);
        const imageElement = new Image();
        imageElement.src = imageObjectURL;
        imageElement.crossOrigin = "Anonymous";

        imageElement.onload = () => {
          context?.drawImage(imageElement, 0, 0);
          URL.revokeObjectURL(imageObjectURL);
          Render2d?.renderer(context, hasText ? [Render2d.renderText(), Render2d.renderBox({ showClass: false, showNestedClasses: false })] : testData[i].renderTest).draw(result);
        };

        console.log(result);
      }
    } catch (e) {
      console.error(e);
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("url-input")?.addEventListener("input", async (event) => {
    const imageUrl = (event.target as HTMLInputElement).value;
    const image1 = document.getElementById("image1") as HTMLImageElement;
    const newImage = new Image();
    newImage.src = imageUrl;
    image1.crossOrigin = "Anonymous";
    newImage.crossOrigin = "Anonymous";

    newImage.onload = () => {
      image1.src = imageUrl;
      console.log(image1.src);
      run(false);
    };
  });

  const testData = [
    {
      renderTest: [
        Render2d.renderPose(),
        Render2d.renderFace(),
        Render2d.renderHand(),
        Render2d.renderBox({
          showClass: true,
          showText: true,
          showConfidence: true,
          showTraceId: true,
          showNestedClasses: true,
          boxType: BoxType.Simple,
        }),
        Render2d.renderText(),
      ],
      image: "https://raw.githubusercontent.com/64blit/files/main/images_videos/6tb6aa0giyq51.jpg",
    },
    {
      renderTest: [
        Render2d.renderPose(),
        Render2d.renderFace(),
        Render2d.renderHand(),
        Render2d.renderBox({
          showClass: true,
          showText: true,
          showConfidence: true,
          showTraceId: true,
          showNestedClasses: true,
          boxType: BoxType.SimpleSelected,
        }),
        Render2d.renderText(),
      ],
      image: image1Src,
    },
    {
      renderTest: [
        Render2d.renderPose(),
        Render2d.renderFace(),
        Render2d.renderHand(),
        Render2d.renderBox({
          showClass: true,
          showText: true,
          showConfidence: true,
          showTraceId: true,
          showNestedClasses: true,
          boxType: BoxType.Rich,
        }),
        Render2d.renderText(),
      ],
      image: "https://i.imgur.com/auORyKI.jpeg",
    },

    {
      renderTest: [
        Render2d.renderPose(),
        Render2d.renderFace(),
        Render2d.renderHand(),
        Render2d.renderBox({
          showClass: true,
          showText: true,
          showConfidence: true,
          showTraceId: true,
          showNestedClasses: true,
          boxType: BoxType.SimpleSelected,
        }),
        Render2d.renderText(),
      ],
      image: "https://i.imgur.com/YctOUSU.jpeg",
    },

    {
      renderTest: [
        Render2d.renderPose(),
        Render2d.renderFace(),
        Render2d.renderHand(),
        Render2d.renderBox({
          showClass: true,
          showText: true,
          showConfidence: true,
          showTraceId: true,
          showNestedClasses: true,
          boxType: BoxType.SimpleSelected,
        }),
        Render2d.renderText(),
      ],
      image: "https://i.imgur.com/lsVZyTU.jpeg",
    },
    {
      renderTest: [
        Render2d.renderPose(),
        Render2d.renderFace(),
        Render2d.renderHand(),
        Render2d.renderBox({
          showClass: true,
          showText: true,
          showConfidence: true,
          showTraceId: true,
          showNestedClasses: true,
          boxType: BoxType.SimpleSelected,
        }),
        Render2d.renderText(),
      ],
      image: "https://i.imgur.com/tfg5hy4.jpeg",
    },
    {
      renderTest: [
        Render2d.renderPose(),
        Render2d.renderFace(),
        Render2d.renderHand(),
        Render2d.renderBox({
          showClass: true,
          showText: true,
          showConfidence: true,
          showTraceId: true,
          showNestedClasses: true,
          boxType: BoxType.SimpleSelected,
        }),
        Render2d.renderText(),
      ],
      image: "https://i.imgur.com/gn9uhCt.jpeg",
    },
  ];

  run(testData);
});
