document.addEventListener("DOMContentLoaded", function(){
  // Save a reference to key elements
    var html = document.getElementById("html"), 
        css = document.getElementById("css"),
        frame = document.getElementById("frame"), 
        head = frame.contentDocument.head, 
        body_win = frame.contentDocument.body;


    // Check for local storage capabilities in the user's browser and other stuff
    if(window.localStorage) {
      if(!localStorage.getItem("html_val")) {

        var default_html = "<div id=\"frame-message\">This is the pallet, the world to <strong>your</strong> code.</div>\n\n\n<p>You may now clear all fields and begin writing your own HTML and CSS code.<br>\n\n<em>LivePreview &mdash; A front end playground.</em></p>", 
            default_css = "#frame-message {\nbackground: whitesmoke;\nborder: 1px solid lightgray;\npadding: 10px;\nfont-family: arial;\nfont-weight: lighter;\ntext-align: center;\nfont-style: italic;\nfont-size: 2em;\n}\n\n#frame-message:before {\n content: \"\\201c\"; \n font-size: 30px;\n}\n\n#frame-message:after {\n content: \"\\201d\"; \n font-size: 30px;\n}\n\np {\n font-family: sans-serif; \n text-align: center;\n}";

        // Insert some demo HTML code which will be loaded into the HTML box
      localStorage.setItem("html_val", default_html);
} if(!localStorage.getItem("css_val")) {
        // Insert some demo CSS code which will be loaded into the CSS box
        localStorage.setItem("css_val", default_css);
      }
    } 

    // CodeMirror the HTML textarea. Set the line wrapping to true
   var hinput = CodeMirror.fromTextArea(html, {
        mode: "htmlmixed",
        value: this.value,
        lineWrapping: true
    });

   // CodeMirror the CSS textarea. 
   var cssinput =  CodeMirror.fromTextArea(css, {
    mode: "css",
    value: this.value, 
    lineWrapping: true
   });

    // Save references to the CodeMirror instances of the two textareas
     var html_input = document.querySelectorAll(".CodeMirror")[0], 
         css_input = document.querySelectorAll(".CodeMirror")[1];

     html_input.setAttribute("id", "html");
     css_input.setAttribute("id", "css");

    var style = document.createElement("style"),
        iframe_text = document.createElement("div");

    iframe_text.setAttribute("name", "HTML-Content");


   html_input.onkeyup = function() {

    // Whilst the user is typing something into the HTML code box, store that value in the local storage in a key called "html_val"
    if(window.localStorage) {
      localStorage.setItem("html_val", hinput.getValue());

      // If local storage is supported, set the contents of the iFrame's body to the value inside the "html_val" key
      iframe_text.innerHTML = localStorage.getItem("html_val");
    } else {

      // If local storage isn't supported, just set the value of the iFrame's body to what the user is typing
      iframe_text.innerHTML = hinput.getValue();
    }
   }

   css_input.onkeyup = function() {
    if(window.localStorage) {

      // Store the CSS code with line breaks so that they can be shown to the user if they are to visit LivePreview again
      localStorage.setItem("css_val", cssinput.getValue());

      // Replace line breaks with nothing to prevent <br> tags being created in the iFrame's style tag
      style.innerText = localStorage.getItem("css_val").replace(/\n/g, "");
    } else {
      style.innerText = cssinput.getValue().replace(/\n/g, "");
    }
      
   }

   if(window.localStorage) {
      if(localStorage.getItem("html_val")) {

        // Set the value of the HTML textarea to the value stored in the local storage key "html_val"
        hinput.setValue(localStorage.getItem("html_val"));

        // Show the elements in the iFrame
        iframe_text.innerHTML = localStorage.getItem("html_val");

    } if(localStorage.getItem("css_val")) {
        // Set the value of the CSS textarea to the value stored in the local storage key "css_val"
        cssinput.setValue(localStorage.getItem("css_val"));

        // Apply styling in the iFrame
        style.innerText = localStorage.getItem("css_val").replace(/\n/g, "");
    }
  } else {
        
        // This code block will run if local storage isn't supported
        iframe_text.innerHTML = hinput.getValue();

        style.innerText = cssinput.getValue().replace(/\n/g, "");

      }
  body_win.appendChild(iframe_text);
  head.appendChild(style);
}, false);