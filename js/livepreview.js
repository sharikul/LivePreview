document.addEventListener("DOMContentLoaded", function(){
  // Save a reference to key elements
    var html = document.getElementById("html"), 
        css = document.getElementById("css"),
        frame = document.getElementById("frame"), 
        head = frame.contentDocument.head, 
        body_win = frame.contentDocument.body;
        
        // the sass function processes variables

        function sass(e) {
          if(e.match(/\$[A-z]+[\s+]?[=][\s+]?[#]?[()A-z0-9\s+\,\-\'\"\.]+/g)) {

            // get all instances where a variable is included in a property declaration, e.g. background: $lg;
        var instances = e.match(/[A-z\-]+[:][\s+]?[\-]?[A-z-?(?,?\s+?\$)?0-9?]+/g),
        
          // get the instances where the variable has been defined with a value, e.g. $lg = lightgray; The regex string also matches rgba value settings
          set = e.match(/\$[A-z]+[\s+]?[=][\s+]?[#]?[()A-z0-9\s+\,\-\'\"\.]+/g);

          // create an empty settings array for later use
        var settings = [];


        for(var i=0;i<set.length;i++) {
          // split the settings by an equal, so $lg = lightgray becomes ["$lg", "lightgray"]
        var split_settings = set[i].split("=");

        // index the settings in the settings array, so $lg = lightgray appears as settings["$lg"] = "lightgray". Also trim any whitespace
        settings[split_settings[0].replace(/^\s+/g, "").replace(/\s+$/g, "").replace(/[;]/g, "")] = split_settings[1].replace(/^\s+/g, "").replace(/\s+$/g, "");

        // make the changes visible in the passed parameter
        e = e.replace(set[i], "");
        }
        for(var i=0;i<instances.length;i++) {

          // get all variables and replace them with their values from the settings array, so any instances of $lg will be replaced with "lightgray"
          
          if(instances[i].match(/\$[A-z]+/g)) {
            var insts = instances[i].match(/\$[A-z]+/g);
            for(var is = 0;is<insts.length;is++) {
              if(settings[insts[is]]) {
                // only perform the replacing operation if the variable has been defined
              e = e.replace(insts[is], settings[insts[is]]);
            } 
          }
        }
      }
        // semi colons are produced at the start of each string because they're left behind when the settings are replaced. search and replace them.
        var remove_scolons = e.match(/[;\s+]+/g)[0];

        // return the passed parameter with the semi colons at the start removed.
        return e.replace(remove_scolons, "");
        } else {
          return e;
        }
      }


    // Check for local storage capabilities in the user's browser and other stuff
    if(window.localStorage) {

      var default_html = "<div id=\"frame-message\">This is the pallet, the world to <strong>your</strong> code.</div>\n\n\n<p>You may now clear all fields and begin writing your own HTML and CSS code.<br>\n\n<em>LivePreview &mdash; A front end playground.</em></p>",

            default_css = "$lg = lightgray;\n$ws = whitesmoke;\n\n#frame-message {\nbackground: $ws;\nborder: 1px solid $lg;\npadding: 10px;\nfont-family: arial;\nfont-weight: lighter;\ntext-align: center;\nfont-style: italic;\nfont-size: 2em;\n}\n\n#frame-message:before {\n content: \"\\201c\"; \n font-size: 30px;\n}\n\n#frame-message:after {\n content: \"\\201d\"; \n font-size: 30px;\n}\n\np {\n font-family: sans-serif; \n text-align: center;\n}";

      if(!localStorage.getItem("html_val")) {

        // Insert some demo HTML code which will be loaded into the HTML box
      localStorage.setItem("html_val", default_html);
} 

  if(!localStorage.getItem("css_val") || localStorage.getItem("css_val") === "undefined" || localStorage.getItem("css_val").length === 1) {

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
    mode: "text/x-scss",
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
      style.innerText = sass(localStorage.getItem("css_val").replace(/\n/g, ""));
    } else {
      style.innerText = sass(cssinput.getValue().replace(/\n/g, ""));
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
        if (localStorage.getItem("css_val").match(/\$[A-z]+[\s+]?[=][\s+]?[#]?["]?[A-z0-9\s+\,\-]+["]?/g)) {
          style.innerText = sass(localStorage.getItem("css_val").replace(/\n/g, ""));
        } else {
          style.innerText = localStorage.getItem("css_val").replace(/\n/g, "");
        }
    }
  } else {
        
        // This code block will run if local storage isn't supported
        iframe_text.innerHTML = hinput.getValue();

        style.innerText = cssinput.getValue().replace(/\n/g, "");

      }
  body_win.appendChild(iframe_text);
  head.appendChild(style);
}, false);
