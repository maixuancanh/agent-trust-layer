fn main() {
    if let Some((_, wasm_path)) = sails_rs::build_wasm() {
        let previous_no_embed = std::env::var_os("SAILS_NO_EMBED_IDL");
        unsafe {
            std::env::set_var("SAILS_NO_EMBED_IDL", "1");
        }
        sails_rs::ClientBuilder::<::trust_missions_app::Program>::from_wasm_path(&wasm_path)
            .build_idl();
        restore_no_embed(previous_no_embed);

        let idl_path = wasm_path
            .with_file_name(wasm_path.file_stem().expect("wasm path has file stem"))
            .with_extension("idl");
        let idl = std::fs::read_to_string(&idl_path).expect("read generated IDL");
        let patched = patch_idl_for_validation(&idl, "TrustMissions");
        std::fs::write(&idl_path, &patched).expect("write patched IDL");
        sails_rs::embed_idl_to_file(&wasm_path, &patched).expect("embed patched IDL in WASM");
    }
}

fn restore_no_embed(previous: Option<std::ffi::OsString>) {
    unsafe {
        match previous {
            Some(value) => std::env::set_var("SAILS_NO_EMBED_IDL", value),
            None => std::env::remove_var("SAILS_NO_EMBED_IDL"),
        }
    }
}

fn patch_idl_for_validation(idl: &str, service: &str) -> String {
    let marker = format!("@partial\nservice {service}@");
    let target = format!("service {service}@");
    let patched = if idl.contains(&marker) {
        idl.to_owned()
    } else {
        idl.replacen(&target, &marker, 1)
    };
    add_entry_ids(&patched)
}

fn add_entry_ids(idl: &str) -> String {
    let mut output = String::new();
    let mut in_functions = false;
    let mut in_events = false;
    let mut next_entry_id = 0u16;
    let mut next_event_id = 0u16;

    for line in idl.lines() {
        let trimmed = line.trim_start();
        let leading_spaces = line.len() - trimmed.len();
        if trimmed == "events {" {
            in_events = true;
            output.push_str(line);
            output.push('\n');
            continue;
        }
        if trimmed == "functions {" {
            in_functions = true;
            output.push_str(line);
            output.push('\n');
            continue;
        }
        if in_events && trimmed == "}" {
            in_events = false;
        }
        if in_functions && trimmed == "}" {
            in_functions = false;
        }
        if in_events
            && leading_spaces == 8
            && !trimmed.starts_with('}')
            && (trimmed.ends_with('{') || trimmed.ends_with(','))
        {
            output.push_str("        @entry_id: ");
            output.push_str(&next_event_id.to_string());
            output.push('\n');
            next_event_id += 1;
        }
        if in_functions && leading_spaces == 8 && trimmed.contains('(') && trimmed.ends_with(';') {
            output.push_str("        @entry_id: ");
            output.push_str(&next_entry_id.to_string());
            output.push('\n');
            next_entry_id += 1;
        }
        output.push_str(line);
        output.push('\n');
    }

    output
}
