import { EyePopSdk } from '@eyepop.ai/eyepop';

const token = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InFUTWx1V2dRLXgxS1JhUlFMWDZueSJ9.eyJlbWFpbCI6InRvcnN0ZW5AZXllcG9wLmFpIiwiaHR0cHM6Ly9jbGFpbXMuZXllcG9wLmFpL2dyYW50cyI6W3sicGVybWlzc2lvbiI6ImFjY2VzczppbmZlcmVuY2UtYXBpIiwidGFyZ2V0IjoidXNlcjphdXRoMHw2NTFiMmM2YTVkMzFkNDk3NTg1ZGQ3ZTAifV0sImlzcyI6Imh0dHBzOi8vZXllcG9wLnVzLmF1dGgwLmNvbS8iLCJzdWIiOiJhdXRoMHw2NTFiMmM2YTVkMzFkNDk3NTg1ZGQ3ZTAiLCJhdWQiOlsiaHR0cHM6Ly9hcGkuZXllcG9wLmFpIiwiaHR0cHM6Ly9leWVwb3AudXMuYXV0aDAuY29tL3VzZXJpbmZvIl0sImlhdCI6MTcwNzAwNDMyMywiZXhwIjoxNzA3MDkwNzIzLCJhenAiOiJVd1VNNlgzZ3UwTGdoM3RBQ3BRMEt1NG15bFlkS2I5NSIsInNjb3BlIjoib3BlbmlkIHByb2ZpbGUgZW1haWwiLCJwZXJtaXNzaW9ucyI6WyJhZG1pbjpjbG91ZC1pbnN0YW5jZXMiLCJhZG1pbjpjbG91ZHMiXX0.oDM-yHkEHoESQjSYEGWQI3tF0_Rn8QPeaEmAPLQmyyVxXk3Xj3qGg92X1kkztQahfgTkDW_FmutPixYp_RvNxe-jhR5snnN0DgzuWjBAjlxYukMu8EidqQPDhbfg-eBVPELoPRinCPpLvoB-8JNom6Z1ZwrBSK0jM3wGJFbsPw2eMUH9kt_m8EHucnEYCGyWFBLdGLmXM2gUoa92JweJ8N4iDjADYcBX9QvzbYAun2qj1j_Zdalirv1ClJkZj_ea_PbD_6Sli1vxK_LwsVTmw-hX-EsnY7KGPIry_gWg5zrHS6djGGcMC5XdXHqn2a4lrYrTik2bUwZP9DlTnvMIrA';
const popId = '09ff30fb09224fe19b2cb11fa3bdccf1';

let endpoint = undefined;

async function component() {
  const element = document.createElement('div');
  endpoint = EyePopSdk.endpoint({
    popId: popId,
    accessToken: token
  })
  await endpoint.connect();
  // Lodash, now imported by this script
  element.innerHTML = 'Hello' +  ':' + endpoint.popName()

  return element;
}

document.body.appendChild(await component());

document.getElementById('file-upload').addEventListener('change', function (event) {
    displayPreviewImage(event);
    GetJSONFromEyePop_file(event.target.files[0]);
});

function displayPreviewImage(event) {
  console.log(event.target.files[0]);
    const reader = new FileReader();
    reader.onload = function () {
        const preview = document.getElementById('image-preview');
        preview.src = reader.result;
        preview.style.display = 'block';
    };
    reader.readAsDataURL(event.target.files[0]);
}

function clearDisplay() {
    document.getElementById("timing").innerHTML = "__ms";
    document.getElementById('txt_json').innerHTML = "<span class='text-muted'>processing</a>";
}

function GetJSONFromEyePop_file(file) {
    let formData = new FormData()
    formData.append('file', file)

    const startTime = performance.now();
    clearDisplay();

    endpoint.upload({file: file}).then(async (results) => {
      for await (let result of results) {
        document.getElementById('txt_json').textContent = JSON.stringify(result, " ", 2);
        console.log(result);
      }
      document.getElementById("timing").innerHTML = Math.floor(performance.now() - startTime) + "ms";
      formatPre();
    });
}
function formatPre()
{
    // Grab the text content of the <pre> element
    let preContent = document.getElementById('txt_json').textContent;

    // Convert the string to a JavaScript object
    let parsedJson = JSON.parse(preContent);

    // Let the jazzing up begin!
    jazzUpClassLabels(parsedJson);

    // Convert the jazzed-up object back to a string
    let newPreContent = JSON.stringify(parsedJson, null, 2);

    // Put the newly minted, jazzed-up JSON back into the <pre> element, complete with sassy bold classLabels!
    document.getElementById('txt_json').innerHTML = newPreContent.replace(/&quot/g,'"') //.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"(<span class=\\"bold\\">.*?<\/span>)"/g, '$1');
}

function jazzUpClassLabels(obj) {
    for (let key in obj) {
        if (typeof obj[key] === "object") {
            jazzUpClassLabels(obj[key]);
        }
        if (key === "classLabel") {
            obj[key] = `<span class="strong">${obj[key]}</span>`;
        }
    }
}
